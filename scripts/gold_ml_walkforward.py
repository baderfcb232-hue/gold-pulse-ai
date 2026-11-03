#!/usr/bin/env python3
"""RESEARCH ONLY: XGBoost gold M5 walk-forward evaluation.

No MT5 credentials, no broker writes, no network and no order-execution code.
Synthetic smoke data validates the pipeline, NOT strategy profitability.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import balanced_accuracy_score, log_loss
from sklearn.model_selection import TimeSeriesSplit
from xgboost import XGBClassifier

FEATURES = [
    "r1", "r3", "r12", "body", "range", "ema8_ema21",
    "ema21_ema200", "rsi14", "atr_pct", "bb_z", "vol_ratio",
    "hour_sin", "hour_cos"
]


def synthetic_candles(rows=2200):
    rng = np.random.default_rng(20261103)
    times = pd.date_range("2026-01-05", periods=rows, freq="5min", tz="UTC")
    prices = [4000.0]
    for i in range(1, rows):
        # Artificial noise with changing drift; do NOT interpret as XAUUSD.
        drift = 0.00008 * math.sin(i / 55) + 0.00003 * math.sin(i / 8)
        move = float(rng.normal(drift, 0.00065))
        prices.append(prices[-1] * math.exp(move))
    opens = np.asarray([prices[0]] + prices[:-1])
    closes = np.asarray(prices)
    highs = np.maximum(opens, closes) + rng.uniform(.15, .8, rows)
    lows = np.minimum(opens, closes) - rng.uniform(.15, .8, rows)
    return pd.DataFrame({"time": times, "open": opens,
        "high": highs, "low": lows, "close": closes,
        "tick_volume": rng.integers(35, 300, size=rows)})


def load_candles(csv_path):
    data = pd.read_csv(csv_path)
    data.columns = data.columns.str.strip().str.lower()
    for name in ("time", "open", "high", "low", "close", "tick_volume"):
        if name not in data.columns:
            raise ValueError("CSV requires time,open,high,low,close,tick_volume: missing " + name)
    numeric = pd.to_numeric(data["time"], errors="coerce")
    if numeric.notna().all():
        data["time"] = pd.to_datetime(numeric, unit="s", utc=True, errors="coerce")
    else:
        data["time"] = pd.to_datetime(data["time"], utc=True, errors="coerce")
    for name in ("open", "high", "low", "close", "tick_volume"):
        data[name] = pd.to_numeric(data[name], errors="coerce")
    if data["time"].isna().any() or data["time"].duplicated().any():
        raise ValueError("Invalid or duplicate candle timestamps")
    if data[["open", "high", "low", "close", "tick_volume"]].isna().any().any():
        raise ValueError("Missing candle prices or volumes")
    data = data.sort_values("time").reset_index(drop=True)
    if (data[["open", "high", "low", "close"]] <= 0).any().any() or (data["tick_volume"] < 0).any():
        raise ValueError("Negative/zero OHLC or negative volume")
    if ((data["low"] > data[["open", "close"]].min(axis=1)) |
        (data["high"] < data[["open", "close"]].max(axis=1))).any():
        raise ValueError("Invalid candle high/low")
    if len(data) < 900:
        raise ValueError("Need >=900 actual closed M5 candles for chronological evaluation")
    return data


def features_and_targets(data, horizon=3, roundtrip_cost_bps=6.0):
    if horizon < 1 or horizon > 12 or roundtrip_cost_bps < 0:
        raise ValueError("Invalid horizon/cost assumptions")
    d = data.copy()
    close, high, low = d["close"], d["high"], d["low"]
    d["r1"] = np.log(close / close.shift(1))
    d["r3"] = np.log(close / close.shift(3))
    d["r12"] = np.log(close / close.shift(12))
    d["body"] = (close - d["open"]) / close
    d["range"] = (high - low) / close
    fast = close.ewm(span=8, adjust=False).mean()
    slow = close.ewm(span=21, adjust=False).mean()
    trend = close.ewm(span=200, adjust=False).mean()
    d["ema8_ema21"] = (fast - slow) / close
    d["ema21_ema200"] = (slow - trend) / close
    change = close.diff()
    gain = change.clip(lower=0).ewm(alpha=1/14, adjust=False).mean()
    loss = (-change.clip(upper=0)).ewm(alpha=1/14, adjust=False).mean()
    d["rsi14"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    tr = pd.concat([(high - low).abs(), (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1/14, adjust=False).mean()
    d["atr_pct"] = atr / close
    middle = close.rolling(20).mean()
    deviation = close.rolling(20).std()
    d["bb_z"] = (close - middle) / deviation.replace(0, np.nan)
    d["vol_ratio"] = d["tick_volume"] / d["tick_volume"].rolling(20).mean().replace(0, np.nan)
    hour = d["time"].dt.hour + d["time"].dt.minute / 60
    d["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    d["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    future = close.shift(-horizon) / close - 1
    # No label across a trading gap/weekend. Do not extrapolate future prices.
    elapsed = (d["time"].shift(-horizon) - d["time"]).dt.total_seconds()
    future = future.where(elapsed == horizon * 300)
    d["future_bps"] = future * 10000
    d["class"] = np.select(
        [d["future_bps"] < -roundtrip_cost_bps, d["future_bps"] > roundtrip_cost_bps],
        [0, 2], default=1)
    d.loc[d["future_bps"].isna(), "class"] = np.nan
    d = d.iloc[220:].replace([np.inf, -np.inf], np.nan).dropna(
        subset=FEATURES + ["future_bps", "class"]).reset_index(drop=True)
    if len(d) < 660:
        raise ValueError("Not enough usable historical M5 candles after features and future labels")
    return d


def position_metrics(actions, future_bps, cost_bps, horizon):
    returns = []
    for i in range(0, len(actions), horizon):  # avoid overlapping h-bar positions
        side = actions[i]
        if side == 1:  # WAIT
            continue
        direction = -1 if side == 0 else 1
        returns.append(direction * float(future_bps[i]) - cost_bps)
    if not returns:
        return {"trades": 0, "win_rate": None, "mean_net_bps": None,
                "sum_net_bps": 0, "max_drawdown_bps": 0}
    equity = np.cumsum([0.0] + returns)
    return {"trades": len(returns),
        "win_rate": round(float(np.mean(np.asarray(returns) > 0)), 4),
        "mean_net_bps": round(float(np.mean(returns)), 4),
        "sum_net_bps": round(float(np.sum(returns)), 4),
        "max_drawdown_bps": round(float(np.max(np.maximum.accumulate(equity) - equity)), 4)}


def walk_forward(frame, horizon=3, roundtrip_cost_bps=6.0, folds=3):
    if folds < 2 or folds > 5:
        raise ValueError("Invalid fold count")
    test_size = min(250, max(150, len(frame) // (folds + 2)))
    splitter = TimeSeriesSplit(n_splits=folds, test_size=test_size, gap=horizon)
    reports = []
    for fold, (train_idx, test_idx) in enumerate(splitter.split(frame), 1):
        # Purge end of training by forecast horizon. No future test labels leak into fit.
        assert train_idx[-1] + horizon < test_idx[0], "Training/test label overlap"
        train, test = frame.iloc[train_idx], frame.iloc[test_idx]
        if set(train["class"].astype(int)) != {0, 1, 2}:
            raise ValueError("Insufficient BUY/SELL/WAIT classes in training window")
        model = XGBClassifier(
            objective="multi:softprob", num_class=3, n_estimators=90,
            max_depth=3, learning_rate=0.05, subsample=0.85,
            colsample_bytree=0.85, reg_lambda=4, random_state=20261103,
            n_jobs=2, tree_method="hist", eval_metric="mlogloss")
        model.fit(train[FEATURES].to_numpy(), train["class"].astype(int).to_numpy())
        probabilities = model.predict_proba(test[FEATURES].to_numpy())
        selected = probabilities.argmax(axis=1)
        confidence = probabilities.max(axis=1)
        selected = np.where(confidence >= 0.60, selected, 1)
        future = test["future_bps"].to_numpy()
        baseline = np.where(test["ema8_ema21"].to_numpy() > 0, 2, 0)
        observed = test["class"].astype(int).to_numpy()
        reports.append({
            "fold": fold, "train_end": str(train["time"].iloc[-1]),
            "test_start": str(test["time"].iloc[0]), "test_end": str(test["time"].iloc[-1]),
            "train_rows": len(train), "test_rows": len(test),
            "logloss": round(float(log_loss(observed, probabilities, labels=[0, 1, 2])), 4),
            "balanced_accuracy": round(float(balanced_accuracy_score(observed, probabilities.argmax(axis=1))), 4),
            "model": position_metrics(selected, future, roundtrip_cost_bps, horizon),
            "ema_baseline": position_metrics(baseline, future, roundtrip_cost_bps, horizon)
        })
    return reports


def main():
    parser = argparse.ArgumentParser(description="Gold M5 XGBoost research ONLY; no execution")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--csv", type=Path, help="historical broker M5 CSV (not live)")
    source.add_argument("--synthetic-smoke", action="store_true")
    parser.add_argument("--horizon-bars", type=int, default=3)
    parser.add_argument("--roundtrip-cost-bps", type=float, default=6.0)
    args = parser.parse_args()
    data = synthetic_candles() if args.synthetic_smoke else load_candles(args.csv)
    frame = features_and_targets(data, args.horizon_bars, args.roundtrip_cost_bps)
    reports = walk_forward(frame, args.horizon_bars, args.roundtrip_cost_bps)
    output = {"scope": "XAUUSD_M5_RESEARCH_ONLY", "dataset": "SYNTHETIC_SMOKE_NOT_REAL_PRICES"
        if args.synthetic_smoke else "USER_SUPPLIED_HISTORICAL_CSV",
        "model": "XGBoost 3-class BUY/WAIT/SELL", "horizon_bars": args.horizon_bars,
        "roundtrip_cost_assumption_bps": args.roundtrip_cost_bps,
        "production_eligible": False, "trained_on_MT5_live": False,
        "samples": len(frame), "features": FEATURES, "folds": reports,
        "limitations": [
            "Fixed spread/slippage cost assumption; not MT5 broker fills",
            "No stop-loss/take-profit or partial-close simulation",
            "Walk-forward results do not establish future profitability",
            "Synthetic smoke results are NOT a trading-performance test"
        ]}
    print(json.dumps(output, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
