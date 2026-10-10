#property strict
#property version   "1.13"
#property description "NABD JustMarkets MT5 gold EA: EMA/RSI signals, protected risk and estimated net small-profit cycles."

#include <Trade/Trade.mqh>

CTrade g_trade;

//--- strategy and symbol settings
input group "Market and timeframes"
input string          InpSymbol                 = "";          // Blank = chart symbol
input ENUM_TIMEFRAMES InpBiasTimeframe          = PERIOD_M15;  // Direction timeframe
input ENUM_TIMEFRAMES InpEntryTimeframe         = PERIOD_M5;   // Entry timeframe
input int             InpFastEmaPeriod          = 50;
input int             InpSlowEmaPeriod          = 200;
input int             InpRsiPeriod              = 14;
input int             InpAtrPeriod              = 14;

//--- entry filters
input group "Signal filters"
input double          InpRsiLongMin             = 50.0;
input double          InpRsiLongMax             = 70.0;
input double          InpRsiShortMin            = 30.0;
input double          InpRsiShortMax            = 50.0;
input int             InpSupportResistanceBars  = 30;
input int             InpSwingBars              = 5;
input double          InpLevelToleranceAtr      = 0.25;
input double          InpMinBodyAtr             = 0.10;
input double          InpMinTrendGapAtr         = 0.10;
input double          InpMaxEntryDistanceAtr    = 1.50;
input bool            InpRespectNextLevel       = true;

//--- risk and execution
input group "Risk and execution"
input double          InpRiskPercent            = 0.50;        // Equity stop risk for the whole cycle
input double          InpRewardRisk             = 2.00;        // Target = R multiple
input double          InpStopBufferAtr           = 0.20;
input double          InpMinStopAtr             = 0.50;
input double          InpMaxStopAtr             = 3.00;
input double          InpMaxMarginUsePercent    = 25.0;
input int             InpMaxTradesPerDay        = 3;
input double          InpMaxDailyLossPercent    = 2.0;
input int             InpMaxSpreadPoints        = 80;
input int             InpDeviationPoints        = 30;
input long            InpMagicNumber            = 26092301;
input bool            InpEnableLiveTrading      = false;       // Explicit safety switch

//--- time and news protection
input group "Trading schedule and news"
input bool            InpUseTradingHours        = true;
input int             InpTradeStartHour         = 7;           // Broker server time
input int             InpTradeEndHour           = 20;          // Broker server time, exclusive
input bool            InpUseNewsFilter          = true;
input string          InpNewsCurrency           = "USD";
input int             InpMinimumNewsImportance  = 3;           // 3 = high importance
input int             InpNewsMinutesBefore      = 30;
input int             InpNewsMinutesAfter       = 30;
input bool            InpBlockIfCalendarFails   = true;

//--- position management
input group "Open-position management"
input bool            InpUseBreakEven           = true;
input double          InpBreakEvenTriggerAtr    = 1.00;
input double          InpBreakEvenOffsetAtr     = 0.05;
input bool            InpUseAtrTrailing         = false;
input double          InpTrailingStartAtr       = 1.50;
input double          InpTrailingDistanceAtr    = 1.00;
input bool            InpCloseOnEmergencyStop   = true;

// Cash targets are in the account's deposit currency, not necessarily USD.
input group "Small-profit cycles"
input bool            InpUseSmallProfit         = true;
input double          InpBasketProfitTarget     = 1.00;        // Estimated net target for the whole cycle
input int             InpMaxBasketPositions     = 3;           // Hedging accounts; netting uses one order
input int             InpCycleCooldownSeconds   = 60;
input double          InpExitCostPerLot         = 0.00;        // Closing cost floor; entry fees also estimated
input double          InpCloseBufferMoney       = 0.10;        // Additional execution reserve

//--- logging and chart panel
input group "Operations"
input string          InpLogFileName            = "JustMarkets_XAUUSD_Bot.csv";
input bool            InpShowChartPanel         = true;

input group "NABD dashboard coordination (optional)"
input bool            InpEnableNABDLink          = false; // Share runtime settings with a separate bridge EA
input bool            InpNABDAllowRemoteControl  = false; // Accept pause/resume and managed-position controls
void NABDOnTimer();
void NABDOnDeinit();
bool NABDRemotePaused();

struct SignalData
  {
   int      direction;       // 1 = buy, -1 = sell, 0 = no signal
   double   entry;
   double   stop_loss;
   double   take_profit;
   double   atr;
   double   rsi;
   double   bias_fast;
   double   bias_slow;
   double   entry_fast;
   double   support;
   double   resistance;
   double   spread_points;
   string   reason;
  };
void NABDPublishSignal(const SignalData &signal);
void NABDCheckComplete();
void NABDClearSignal();

string   g_symbol = "";
int      g_digits = 0;
double   g_point = 0.0;
int      g_bias_fast_handle = INVALID_HANDLE;
int      g_bias_slow_handle = INVALID_HANDLE;
int      g_bias_atr_handle  = INVALID_HANDLE;
int      g_entry_fast_handle = INVALID_HANDLE;
int      g_entry_rsi_handle  = INVALID_HANDLE;
int      g_entry_atr_handle  = INVALID_HANDLE;
datetime g_last_entry_bar = 0;
string   g_emergency_key = "";
string   g_cycle_key = "";
datetime g_cycle_start = 0;
datetime g_last_cycle_end = 0;
datetime g_next_close_attempt = 0;
bool     g_cycle_closing = false;
double   g_cycle_net = 0.0;
bool     g_cycle_net_valid = false;
datetime g_last_claimed_bar = 0;

//--- function declarations
bool   CreateIndicatorHandles();
void   ReleaseIndicatorHandles();
bool   ReadIndicatorValue(const int handle,const int shift,double &value);
bool   IsNewEntryBar();
bool   TradingExecutionEnabled();
bool   BuildSignal(SignalData &signal);
bool   PlaceSignal(const SignalData &signal);
void   ManageOpenPositions();
bool   IsEmergencyStopActive();
void   CloseOwnPositions();
bool   HasOwnPosition();
int    CountOwnPositions();
int    CountTodayEntries();
double GetTodayNet();
bool   DailyRiskLimitReached(string &reason);
bool   IsHighImpactNewsWindow(string &reason);
bool   IsWithinTradingHours();
double RecentLow(const int start_shift,const int count);
double RecentHigh(const int start_shift,const int count);
double CalculateVolume(const ENUM_ORDER_TYPE order_type,const double entry,const double stop_loss);
bool   MarginIsAcceptable(const ENUM_ORDER_TYPE order_type,const double entry,const double volume);
int    VolumeDigits(const double step);
double NormalizePrice(const double price);
double MinimumStopDistance();
void   UpdateChartPanel();
void   LogEvent(const string event_name,const string details);
bool   IsSuccessfulRetcode(const uint retcode);
datetime ServerNow();
datetime StartOfDay(const datetime when);
bool   IsOwnPositionSelected();
bool   IsHedgingAccount();
bool   HasForeignNettingExposure();
bool   HasOwnPendingOrder();
bool   ExecutionPermissionsAvailable();
void   InitializeCycleState();
void   SyncCycleState();
void   FinishCycle();
bool   CycleNetEstimate(double &net);
bool   ManageSmallProfitCycle();
void   CloseCyclePositions(const string reason);
bool   ClaimEntryBar();
double StoredCycleValue(const string suffix);
void   StoreCycleValue(const string suffix,const double value);
bool   IsJustMarketsAccount();

// Exact broker family and suffix validation; no credentials are read or logged.
bool JMServerAllowed(const string server)
  {
   string name=server;
   StringToLower(name);
   string prefix="justmarkets-";
   if(StringFind(name,prefix)!=0)
      return(false);
   string suffix=StringSubstr(name,StringLen(prefix));
   if(StringFind(suffix,"live")!=0 && StringFind(suffix,"demo")!=0)
      return(false);
   for(int i=4;i<StringLen(suffix);i++)
     {
      ushort ch=StringGetCharacter(suffix,i);
      if(ch<48 || ch>57)
         return(false);
     }
   return(true);
  }

bool IsJustMarketsAccount()
  {
   return(MQLInfoInteger(MQL_TESTER) || JMServerAllowed(AccountInfoString(ACCOUNT_SERVER)));
  }

// BEGIN SMALL_PROFIT_POLICY
// These pure functions are shared by execution and the portable policy checks.
double SPNetAfterCosts(const double floating_net,const double booked_net,
                      const double exit_reserve,const double buffer)
  {
   return(floating_net+booked_net-exit_reserve-buffer);
  }

bool SPTargetReached(const int positions,const bool fresh,const bool valid,
                     const double net,const double target)
  {
   return(positions>0 && fresh && valid && MathIsValidNumber(net) &&
          MathIsValidNumber(target) && target>0.0 && net>=target);
  }

int SPPlanLegCount(const int requested,const int day_remaining,const bool hedging,
                   const double total_volume,const double minimum)
  {
   if(requested<1 || day_remaining<1 || minimum<=0.0 || total_volume<minimum)
      return(0);
   int possible=(int)MathFloor(total_volume/minimum+1.0e-9);
   int count=(int)MathMin(requested,MathMin(day_remaining,possible));
   return(hedging ? count : (int)MathMin(count,1));
  }

double SPVolumePerLeg(const double total_volume,const int legs,const double minimum,
                      const double step)
  {
   if(legs<1 || minimum<=0.0 || step<=0.0 || total_volume<=0.0)
      return(0.0);
   double volume=MathFloor(total_volume/legs/step+1.0e-9)*step;
   if(volume<minimum-1.0e-9 || volume*legs>total_volume+1.0e-9)
      return(0.0);
   return(volume);
  }
// END SMALL_PROFIT_POLICY

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(!IsJustMarketsAccount())
     {
      Print("This EA requires a JustMarkets MT5 account. Check the server in account details.");
      return(INIT_FAILED);
     }
   if(!MathIsValidNumber(InpRiskPercent) || InpRiskPercent<=0.0 || InpRiskPercent>100.0 ||
      InpMaxTradesPerDay<1 || !MathIsValidNumber(InpMaxDailyLossPercent) ||
      InpMaxDailyLossPercent<=0.0 || InpMaxDailyLossPercent>100.0 ||
      !MathIsValidNumber(InpMaxMarginUsePercent) ||
      InpMaxMarginUsePercent<=0.0 || InpMaxMarginUsePercent>100.0 ||
      InpMaxBasketPositions<1 || InpMaxBasketPositions>20 ||
      !MathIsValidNumber(InpBasketProfitTarget) || InpBasketProfitTarget<=0.0 ||
      !MathIsValidNumber(InpExitCostPerLot) || InpExitCostPerLot<0.0 ||
      !MathIsValidNumber(InpCloseBufferMoney) || InpCloseBufferMoney<0.0 ||
      InpCycleCooldownSeconds<0 || InpDeviationPoints<0 || InpMagicNumber<=0)
     {
      Print("Invalid risk or small-profit settings.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   g_symbol=InpSymbol;
   if(StringLen(g_symbol)==0)
      g_symbol=_Symbol;

   if(!SymbolSelect(g_symbol,true))
     {
      PrintFormat("SymbolSelect failed for %s. Error=%d",g_symbol,GetLastError());
      return(INIT_FAILED);
     }

   g_digits=(int)SymbolInfoInteger(g_symbol,SYMBOL_DIGITS);
   g_point=SymbolInfoDouble(g_symbol,SYMBOL_POINT);
   if(g_point<=0.0)
     {
      Print("Invalid symbol point size.");
      return(INIT_FAILED);
     }

   if(!CreateIndicatorHandles())
      return(INIT_FAILED);

   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(InpDeviationPoints);
   g_trade.SetTypeFillingBySymbol(g_symbol);
   g_trade.SetMarginMode();
   g_trade.SetAsyncMode(false);

   g_emergency_key=StringFormat("JM_XAU_STOP_%I64d",InpMagicNumber);
   if(!GlobalVariableCheck(g_emergency_key))
      GlobalVariableSet(g_emergency_key,0.0);

   InitializeCycleState();
   if(!EventSetMillisecondTimer(500))
     {
      ReleaseIndicatorHandles();
      return(INIT_FAILED);
     }
   LogEvent("INIT",StringFormat("symbol=%s live=%s",g_symbol,InpEnableLiveTrading ? "true" : "false"));
   NABDClearSignal();
   UpdateChartPanel();
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   NABDOnDeinit();
   EventKillTimer();
   ReleaseIndicatorHandles();
   if(InpShowChartPanel)
      Comment("");
   LogEvent("DEINIT",StringFormat("reason=%d",reason));
  }

//+------------------------------------------------------------------+
//| Tick handler                                                     |
//+------------------------------------------------------------------+
void OnTick()
  {
   if(IsEmergencyStopActive())
     {
      if(TradingExecutionEnabled() && InpCloseOnEmergencyStop)
         CloseOwnPositions();
      UpdateChartPanel();
      return;
     }

   ManageOpenPositions();

   if(g_cycle_closing || (InpUseSmallProfit && g_last_cycle_end>0 &&
      ServerNow()-g_last_cycle_end<InpCycleCooldownSeconds))
      return;

   if(NABDRemotePaused())
     {
      IsNewEntryBar();
      return;
     }

   if(!IsNewEntryBar())
      return;

   SignalData signal;
   if(!BuildSignal(signal))
     {
      NABDCheckComplete();
      PrintFormat("No trade: %s",signal.reason);
      LogEvent("NO_SIGNAL",signal.reason);
      UpdateChartPanel();
      return;
     }

   PrintFormat("Signal %s entry=%.*f SL=%.*f TP=%.*f RSI=%.2f ATR=%.*f",
               signal.direction>0 ? "BUY" : "SELL",
               g_digits,signal.entry,g_digits,signal.stop_loss,g_digits,signal.take_profit,
               signal.rsi,g_digits,signal.atr);
   LogEvent("SIGNAL",StringFormat("side=%s,entry=%.*f,sl=%.*f,tp=%.*f,rsi=%.2f,atr=%.*f",
                                   signal.direction>0 ? "BUY" : "SELL",
                                   g_digits,signal.entry,g_digits,signal.stop_loss,g_digits,signal.take_profit,
                                   signal.rsi,g_digits,signal.atr));
   NABDPublishSignal(signal);

   if(!TradingExecutionEnabled())
     {
      Print("Live trading is disabled. Signal was logged only.");
      UpdateChartPanel();
      return;
     }

   PlaceSignal(signal);
   UpdateChartPanel();
  }

//+------------------------------------------------------------------+
//| Timer handler                                                    |
//+------------------------------------------------------------------+
void OnTimer()
  {
   if(IsEmergencyStopActive())
     {
      if(ExecutionPermissionsAvailable() && InpCloseOnEmergencyStop)
         CloseOwnPositions();
      SyncCycleState();
      UpdateChartPanel();
      NABDOnTimer();
      return;
     }
   ManageOpenPositions();
   UpdateChartPanel();
   NABDOnTimer();
  }

//+------------------------------------------------------------------+
//| Trade transaction logger                                         |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &transaction,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   if(transaction.type!=TRADE_TRANSACTION_DEAL_ADD || transaction.deal==0)
      return;
   if(!HistoryDealSelect(transaction.deal))
      return;

   if((long)HistoryDealGetInteger(transaction.deal,DEAL_MAGIC)!=InpMagicNumber)
      return;
   if(HistoryDealGetString(transaction.deal,DEAL_SYMBOL)!=g_symbol)
      return;

   double profit=HistoryDealGetDouble(transaction.deal,DEAL_PROFIT);
   double commission=HistoryDealGetDouble(transaction.deal,DEAL_COMMISSION);
   double swap=HistoryDealGetDouble(transaction.deal,DEAL_SWAP);
   double fee=HistoryDealGetDouble(transaction.deal,DEAL_FEE);
   LogEvent("DEAL",StringFormat("ticket=%I64u,entry=%d,profit=%.2f,commission=%.2f,swap=%.2f,fee=%.2f",
                                 transaction.deal,
                                 (int)HistoryDealGetInteger(transaction.deal,DEAL_ENTRY),
                                 profit,commission,swap,fee));
  }

//+------------------------------------------------------------------+
//| Indicator handles                                                |
//+------------------------------------------------------------------+
bool CreateIndicatorHandles()
  {
   g_bias_fast_handle=iMA(g_symbol,InpBiasTimeframe,InpFastEmaPeriod,0,MODE_EMA,PRICE_CLOSE);
   g_bias_slow_handle=iMA(g_symbol,InpBiasTimeframe,InpSlowEmaPeriod,0,MODE_EMA,PRICE_CLOSE);
   g_bias_atr_handle=iATR(g_symbol,InpBiasTimeframe,InpAtrPeriod);
   g_entry_fast_handle=iMA(g_symbol,InpEntryTimeframe,InpFastEmaPeriod,0,MODE_EMA,PRICE_CLOSE);
   g_entry_rsi_handle=iRSI(g_symbol,InpEntryTimeframe,InpRsiPeriod,PRICE_CLOSE);
   g_entry_atr_handle=iATR(g_symbol,InpEntryTimeframe,InpAtrPeriod);

   if(g_bias_fast_handle==INVALID_HANDLE || g_bias_slow_handle==INVALID_HANDLE ||
      g_bias_atr_handle==INVALID_HANDLE || g_entry_fast_handle==INVALID_HANDLE ||
      g_entry_rsi_handle==INVALID_HANDLE || g_entry_atr_handle==INVALID_HANDLE)
     {
      PrintFormat("Indicator handle creation failed. Error=%d",GetLastError());
      ReleaseIndicatorHandles();
      return(false);
     }
   return(true);
  }

void ReleaseIndicatorHandles()
  {
   if(g_bias_fast_handle!=INVALID_HANDLE)  IndicatorRelease(g_bias_fast_handle);
   if(g_bias_slow_handle!=INVALID_HANDLE)  IndicatorRelease(g_bias_slow_handle);
   if(g_bias_atr_handle!=INVALID_HANDLE)   IndicatorRelease(g_bias_atr_handle);
   if(g_entry_fast_handle!=INVALID_HANDLE) IndicatorRelease(g_entry_fast_handle);
   if(g_entry_rsi_handle!=INVALID_HANDLE)  IndicatorRelease(g_entry_rsi_handle);
   if(g_entry_atr_handle!=INVALID_HANDLE)  IndicatorRelease(g_entry_atr_handle);
   g_bias_fast_handle=INVALID_HANDLE;
   g_bias_slow_handle=INVALID_HANDLE;
   g_bias_atr_handle=INVALID_HANDLE;
   g_entry_fast_handle=INVALID_HANDLE;
   g_entry_rsi_handle=INVALID_HANDLE;
   g_entry_atr_handle=INVALID_HANDLE;
  }

bool ReadIndicatorValue(const int handle,const int shift,double &value)
  {
   value=0.0;
   if(handle==INVALID_HANDLE)
      return(false);
   double buffer[1];
   ResetLastError();
   if(CopyBuffer(handle,0,shift,1,buffer)!=1)
      return(false);
   value=buffer[0];
   return(value!=EMPTY_VALUE && MathIsValidNumber(value));
  }

//+------------------------------------------------------------------+
//| New closed entry candle check                                    |
//+------------------------------------------------------------------+
bool IsNewEntryBar()
  {
   datetime closed_bar=iTime(g_symbol,InpEntryTimeframe,1);
   if(closed_bar<=0 || closed_bar==g_last_entry_bar)
      return(false);
   g_last_entry_bar=closed_bar;
   return(true);
  }

// Strategy Tester orders are simulated by MT5 and never reach a live account.
// This keeps live execution explicitly locked while still allowing backtests.
bool TradingExecutionEnabled()
  {
   return(InpEnableLiveTrading || MQLInfoInteger(MQL_TESTER));
  }

//+------------------------------------------------------------------+
//| Strategy signal construction                                     |
//+------------------------------------------------------------------+
bool BuildSignal(SignalData &signal)
  {
   signal.direction=0;
   signal.entry=0.0;
   signal.stop_loss=0.0;
   signal.take_profit=0.0;
   signal.atr=0.0;
   signal.rsi=0.0;
   signal.bias_fast=0.0;
   signal.bias_slow=0.0;
   signal.entry_fast=0.0;
   signal.support=0.0;
   signal.resistance=0.0;
   signal.spread_points=0.0;
   signal.reason="unknown";

   if(HasOwnPosition())
     {
      signal.reason="an EA position is already open";
      return(false);
     }

   if(g_cycle_closing || HasOwnPendingOrder() || HasForeignNettingExposure())
     {
      signal.reason="a cycle is closing, an order is pending, or the netting symbol is shared";
      return(false);
     }

   if(TradingExecutionEnabled() && !TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
     {
      signal.reason="terminal trading is not allowed";
      return(false);
     }

   if(!IsWithinTradingHours())
     {
      signal.reason="outside configured broker-server trading hours";
      return(false);
     }

   MqlTick tick;
   if(!SymbolInfoTick(g_symbol,tick) || tick.ask<=0.0 || tick.bid<=0.0)
     {
      signal.reason="no valid tick received";
      return(false);
     }

   signal.entry=(tick.ask+tick.bid)*0.5;
   signal.spread_points=(tick.ask-tick.bid)/g_point;
   if(signal.spread_points>InpMaxSpreadPoints)
     {
      signal.reason=StringFormat("spread %.1f points is above the limit %d",signal.spread_points,InpMaxSpreadPoints);
      return(false);
     }

   string news_reason="";
   if(IsHighImpactNewsWindow(news_reason))
     {
      signal.reason=news_reason;
      return(false);
     }

   string daily_reason="";
   if(DailyRiskLimitReached(daily_reason))
     {
      signal.reason=daily_reason;
      return(false);
     }

   int bias_bars=Bars(g_symbol,InpBiasTimeframe);
   int entry_bars=Bars(g_symbol,InpEntryTimeframe);
   if(bias_bars<InpSlowEmaPeriod+10 || entry_bars<InpSupportResistanceBars+InpSwingBars+10)
     {
      signal.reason="not enough historical bars yet";
      return(false);
     }

   double bias_close=iClose(g_symbol,InpBiasTimeframe,1);
   double entry_open=iOpen(g_symbol,InpEntryTimeframe,1);
   double entry_high=iHigh(g_symbol,InpEntryTimeframe,1);
   double entry_low=iLow(g_symbol,InpEntryTimeframe,1);
   double entry_close=iClose(g_symbol,InpEntryTimeframe,1);
   double previous_close=iClose(g_symbol,InpEntryTimeframe,2);
   if(bias_close<=0.0 || entry_open<=0.0 || entry_high<=0.0 || entry_low<=0.0 || entry_close<=0.0)
     {
      signal.reason="price history is not ready";
      return(false);
     }

   double bias_atr=0.0;
   if(!ReadIndicatorValue(g_bias_fast_handle,1,signal.bias_fast) ||
      !ReadIndicatorValue(g_bias_slow_handle,1,signal.bias_slow) ||
      !ReadIndicatorValue(g_bias_atr_handle,1,bias_atr) ||
      !ReadIndicatorValue(g_entry_fast_handle,1,signal.entry_fast) ||
      !ReadIndicatorValue(g_entry_rsi_handle,1,signal.rsi) ||
      !ReadIndicatorValue(g_entry_atr_handle,1,signal.atr))
     {
      signal.reason="indicator data is not ready";
      return(false);
     }

   if(signal.atr<=0.0 || bias_atr<=0.0)
     {
      signal.reason="ATR is invalid";
      return(false);
     }

   double trend_gap=MathAbs(signal.bias_fast-signal.bias_slow);
   if(trend_gap<bias_atr*InpMinTrendGapAtr)
     {
      signal.reason="EMA gap is too small; market may be sideways";
      return(false);
     }

   signal.support=RecentLow(2,InpSupportResistanceBars);
   signal.resistance=RecentHigh(2,InpSupportResistanceBars);
   if(signal.support<=0.0 || signal.resistance<=0.0 || signal.support>=signal.resistance)
     {
      signal.reason="support/resistance data is invalid";
      return(false);
     }

   double tolerance=signal.atr*InpLevelToleranceAtr;
   double body=MathAbs(entry_close-entry_open);
   bool bullish_trend=(signal.bias_fast>signal.bias_slow && bias_close>signal.bias_fast);
   bool bearish_trend=(signal.bias_fast<signal.bias_slow && bias_close<signal.bias_fast);
   bool bullish_candle=(entry_close>entry_open && entry_close>previous_close && body>=signal.atr*InpMinBodyAtr);
   bool bearish_candle=(entry_close<entry_open && entry_close<previous_close && body>=signal.atr*InpMinBodyAtr);
   bool long_pullback=((entry_low<=signal.entry_fast+tolerance && entry_close>=signal.entry_fast-tolerance) ||
                       (entry_low<=signal.support+tolerance && entry_close>=signal.support-tolerance));
   bool short_pullback=((entry_high>=signal.entry_fast-tolerance && entry_close<=signal.entry_fast+tolerance) ||
                        (entry_high>=signal.resistance-tolerance && entry_close<=signal.resistance+tolerance));
   bool long_rsi=(signal.rsi>=InpRsiLongMin && signal.rsi<=InpRsiLongMax);
   bool short_rsi=(signal.rsi>=InpRsiShortMin && signal.rsi<=InpRsiShortMax);
   bool reasonable_distance=(MathAbs(entry_close-signal.entry_fast)<=signal.atr*InpMaxEntryDistanceAtr);

   if(bullish_trend && bullish_candle && long_pullback && long_rsi && reasonable_distance)
     {
      signal.direction=1;
      signal.entry=tick.ask;
      double swing_low=RecentLow(2,InpSwingBars);
      signal.stop_loss=MathMin(swing_low,entry_low)-signal.atr*InpStopBufferAtr;
      double min_stop=MathMax(signal.atr*InpMinStopAtr,MinimumStopDistance());
      double max_stop=signal.atr*InpMaxStopAtr;
      if(signal.entry-signal.stop_loss<min_stop)
         signal.stop_loss=signal.entry-min_stop;
      if(signal.entry-signal.stop_loss>max_stop)
        {
         signal.reason="long stop distance is too wide";
         signal.direction=0;
         return(false);
        }
      signal.stop_loss=NormalizePrice(signal.stop_loss);
      signal.take_profit=NormalizePrice(signal.entry+(signal.entry-signal.stop_loss)*InpRewardRisk);
      if(InpRespectNextLevel && signal.resistance>signal.entry && signal.resistance<=signal.take_profit)
        {
         signal.reason="next resistance is inside the planned long target";
         signal.direction=0;
         return(false);
        }
      signal.reason="bullish M15 trend + M5 pullback confirmation";
      return(true);
     }

   if(bearish_trend && bearish_candle && short_pullback && short_rsi && reasonable_distance)
     {
      signal.direction=-1;
      signal.entry=tick.bid;
      double swing_high=RecentHigh(2,InpSwingBars);
      signal.stop_loss=MathMax(swing_high,entry_high)+signal.atr*InpStopBufferAtr;
      double min_stop=MathMax(signal.atr*InpMinStopAtr,MinimumStopDistance());
      double max_stop=signal.atr*InpMaxStopAtr;
      if(signal.stop_loss-signal.entry<min_stop)
         signal.stop_loss=signal.entry+min_stop;
      if(signal.stop_loss-signal.entry>max_stop)
        {
         signal.reason="short stop distance is too wide";
         signal.direction=0;
         return(false);
        }
      signal.stop_loss=NormalizePrice(signal.stop_loss);
      signal.take_profit=NormalizePrice(signal.entry-(signal.stop_loss-signal.entry)*InpRewardRisk);
      if(InpRespectNextLevel && signal.support<signal.entry && signal.support>=signal.take_profit)
        {
         signal.reason="next support is inside the planned short target";
         signal.direction=0;
         return(false);
        }
      signal.reason="bearish M15 trend + M5 pullback confirmation";
      return(true);
     }

   signal.reason="EMA trend, RSI, pullback and candle confirmation did not align";
   return(false);
  }

//+------------------------------------------------------------------+
//| Order placement                                                  |
//+------------------------------------------------------------------+
bool PlaceSignal(const SignalData &signal)
  {
   if(!ExecutionPermissionsAvailable() || HasOwnPosition() || HasOwnPendingOrder() ||
      HasForeignNettingExposure() || g_cycle_closing)
      return(false);

   ENUM_ORDER_TYPE order_type=(signal.direction>0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
   double total_volume=CalculateVolume(order_type,signal.entry,signal.stop_loss);
   double minimum=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN);
   double step=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP);
   int remaining=InpMaxTradesPerDay-CountTodayEntries();
   int legs=SPPlanLegCount(InpUseSmallProfit ? InpMaxBasketPositions : 1,
                          remaining,IsHedgingAccount(),total_volume,minimum);
   double volume=SPVolumePerLeg(total_volume,legs,minimum,step);
   volume=NormalizeDouble(volume,VolumeDigits(step));
   if(volume<=0.0 || legs<1)
     {
      Print("Order skipped: calculated volume is below broker minimum or invalid.");
      LogEvent("ORDER_BLOCKED","volume calculation failed");
      return(false);
     }

   string side=(signal.direction>0 ? "BUY" : "SELL");
   string comment=StringFormat("XAU_BOT_%s",side);
   // Split the original 0.50% risk budget; never multiply it by the leg count.
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double budget=MathMin(equity*InpRiskPercent/100.0,
                        MathMax(0.0,equity*InpMaxDailyLossPercent/100.0+GetTodayNet()));
   double risk_per_leg=budget/legs;
   double actual_volume=0.0;
   int accepted=0;
   if(!ClaimEntryBar())
      return(false);
   for(int leg=0;leg<legs;leg++)
     {
      MqlTick tick;
      if(!SymbolInfoTick(g_symbol,tick) || tick.ask<=0.0 || tick.bid<=0.0 ||
         tick.ask<tick.bid || ServerNow()-tick.time>10 || tick.time>ServerNow()+2 ||
         (tick.ask-tick.bid)/g_point>InpMaxSpreadPoints || IsEmergencyStopActive())
         break;
      double price=signal.direction>0 ? tick.ask : tick.bid;
      double distance=signal.direction>0 ? tick.bid-signal.stop_loss : signal.stop_loss-tick.ask;
      double profit=0.0;
      if(distance<=MinimumStopDistance() ||
         !OrderCalcProfit(order_type,g_symbol,volume,price,signal.stop_loss,profit) ||
         MathAbs(profit)>risk_per_leg+1.0e-8 ||
         !MarginIsAcceptable(order_type,price,volume))
        {
         LogEvent("ORDER_BLOCKED","fresh price, stop risk, or combined margin check failed");
         break;
        }
      datetime started=ServerNow();
      bool request_ok=signal.direction>0 ?
         g_trade.Buy(volume,g_symbol,0.0,signal.stop_loss,signal.take_profit,comment) :
         g_trade.Sell(volume,g_symbol,0.0,signal.stop_loss,signal.take_profit,comment);
      uint retcode=g_trade.ResultRetcode();
      bool ok=request_ok && IsSuccessfulRetcode(retcode);
      string result_text=StringFormat("side=%s,leg=%d/%d,volume=%.4f,retcode=%u,%s",
                                      side,leg+1,legs,volume,retcode,g_trade.ResultRetcodeDescription());
      LogEvent(ok ? "ORDER_ACCEPTED" : "ORDER_REJECTED",result_text);
      if(!ok)
         break;
      accepted++;
      actual_volume+=volume;
      if(g_cycle_start==0)
        {
         g_cycle_start=started;
         StoreCycleValue("_start",(double)g_cycle_start);
         if(!MQLInfoInteger(MQL_TESTER))
            GlobalVariablesFlush();
        }
      // An accepted pending/partial request must finish before more orders are sent.
      if(retcode!=TRADE_RETCODE_DONE)
         break;
     }
   LogEvent("CYCLE_ENTRY",StringFormat("accepted=%d,planned=%d,volume=%.4f,target=%.2f %s",
                                       accepted,legs,actual_volume,InpBasketProfitTarget,
                                       AccountInfoString(ACCOUNT_CURRENCY)));
   return(accepted>0);
  }

//+------------------------------------------------------------------+
//| Position management                                              |
//+------------------------------------------------------------------+
void ManageOpenPositions()
  {
   if(!ExecutionPermissionsAvailable())
      return;
   if(IsEmergencyStopActive())
      return;
   if(ManageSmallProfitCycle())
      return;
   if(!InpUseBreakEven && !InpUseAtrTrailing)
      return;

   double atr=0.0;
   if(!ReadIndicatorValue(g_entry_atr_handle,1,atr) || atr<=0.0)
      return;
   MqlTick tick;
   if(!SymbolInfoTick(g_symbol,tick))
      return;

   double min_distance=MinimumStopDistance();
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !PositionSelectByTicket(ticket))
         continue;
      if(!IsOwnPositionSelected())
         continue;

      long type=PositionGetInteger(POSITION_TYPE);
      double open_price=PositionGetDouble(POSITION_PRICE_OPEN);
      double current_sl=PositionGetDouble(POSITION_SL);
      double current_tp=PositionGetDouble(POSITION_TP);
      double candidate=current_sl;
      bool should_modify=false;

      if(type==POSITION_TYPE_BUY)
        {
         double favorable=tick.bid-open_price;
         if(InpUseBreakEven && favorable>=atr*InpBreakEvenTriggerAtr)
           {
            double be=open_price+atr*InpBreakEvenOffsetAtr;
            if((current_sl==0.0 || be>current_sl) && be<tick.bid-min_distance)
              {
               candidate=be;
               should_modify=true;
              }
           }
         if(InpUseAtrTrailing && favorable>=atr*InpTrailingStartAtr)
           {
            double trail=tick.bid-atr*InpTrailingDistanceAtr;
            if((candidate==0.0 || trail>candidate) && trail<tick.bid-min_distance)
              {
               candidate=trail;
               should_modify=true;
              }
           }
        }
      else if(type==POSITION_TYPE_SELL)
        {
         double favorable=open_price-tick.ask;
         if(InpUseBreakEven && favorable>=atr*InpBreakEvenTriggerAtr)
           {
            double be=open_price-atr*InpBreakEvenOffsetAtr;
            if((current_sl==0.0 || be<current_sl) && be>tick.ask+min_distance)
              {
               candidate=be;
               should_modify=true;
              }
           }
         if(InpUseAtrTrailing && favorable>=atr*InpTrailingStartAtr)
           {
            double trail=tick.ask+atr*InpTrailingDistanceAtr;
            if((candidate==0.0 || trail<candidate) && trail>tick.ask+min_distance)
              {
               candidate=trail;
               should_modify=true;
              }
           }
        }

      if(should_modify)
        {
         candidate=NormalizePrice(candidate);
         if(!g_trade.PositionModify(ticket,candidate,current_tp) ||
            !IsSuccessfulRetcode(g_trade.ResultRetcode()))
            LogEvent("POSITION_MODIFY_FAILED",StringFormat("ticket=%I64u,%s",ticket,g_trade.ResultRetcodeDescription()));
         else
            LogEvent("POSITION_MODIFIED",StringFormat("ticket=%I64u,new_sl=%.*f",ticket,g_digits,candidate));
        }
     }
  }

//+------------------------------------------------------------------+
//| Emergency stop                                                   |
//+------------------------------------------------------------------+
bool IsEmergencyStopActive()
  {
   return(GlobalVariableCheck(g_emergency_key) && GlobalVariableGet(g_emergency_key)>0.5);
  }

void CloseOwnPositions()
  {
   CloseCyclePositions("EMERGENCY");
  }

void CloseCyclePositions(const string reason)
  {
   if(!ExecutionPermissionsAvailable() || ServerNow()<g_next_close_attempt)
      return;
   g_next_close_attempt=ServerNow()+2;
   // Cancel only this EA's orders, so a delayed fill cannot reopen a finished cycle.
   for(int i=OrdersTotal()-1;i>=0;i--)
     {
      ulong order=OrderGetTicket(i);
      if(order==0 || OrderGetString(ORDER_SYMBOL)!=g_symbol ||
         (long)OrderGetInteger(ORDER_MAGIC)!=InpMagicNumber)
         continue;
      if(!g_trade.OrderDelete(order) || g_trade.ResultRetcode()!=TRADE_RETCODE_DONE)
         LogEvent(reason+"_CANCEL_PENDING",StringFormat("order=%I64u,retcode=%u",order,g_trade.ResultRetcode()));
     }
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !PositionSelectByTicket(ticket))
         continue;
      if(!IsOwnPositionSelected())
         continue;
      bool sent=g_trade.PositionClose(ticket,InpDeviationPoints);
      uint code=g_trade.ResultRetcode();
      bool confirmed=sent && code==TRADE_RETCODE_DONE && !PositionSelectByTicket(ticket);
      if(confirmed)
         LogEvent(reason+"_CLOSE",StringFormat("ticket=%I64u,retcode=%u",ticket,code));
      else
         LogEvent(reason+"_CLOSE_PENDING",StringFormat("ticket=%I64u,retcode=%u,%s",ticket,code,
                                                       g_trade.ResultRetcodeDescription()));
     }
  }

bool HasOwnPosition()
  {
   return(CountOwnPositions()>0);
  }

int CountOwnPositions()
  {
   int count=0;
   for(int i=0;i<PositionsTotal();i++)
     {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !PositionSelectByTicket(ticket))
         continue;
      if(IsOwnPositionSelected())
         count++;
     }
   return(count);
  }

//+------------------------------------------------------------------+
//| Isolated small-profit cycle ownership and ledger                 |
//+------------------------------------------------------------------+
bool IsHedgingAccount()
  {
   return(AccountInfoInteger(ACCOUNT_MARGIN_MODE)==ACCOUNT_MARGIN_MODE_RETAIL_HEDGING);
  }

bool IsOwnPositionSelected()
  {
   if(PositionGetString(POSITION_SYMBOL)!=g_symbol ||
      (long)PositionGetInteger(POSITION_MAGIC)!=InpMagicNumber)
      return(false);
   if(IsHedgingAccount())
      return(true);
   // Netting combines trades on a symbol. Refuse a position touched by another
   // strategy/manual trader instead of relying only on its latest MagicNumber.
   ulong id=(ulong)PositionGetInteger(POSITION_IDENTIFIER);
   if(!HistorySelectByPosition(id))
      return(false);
   for(int i=0;i<HistoryDealsTotal();i++)
     {
      ulong deal=HistoryDealGetTicket(i);
      long type=HistoryDealGetInteger(deal,DEAL_TYPE);
      if((type==DEAL_TYPE_BUY || type==DEAL_TYPE_SELL) &&
         (long)HistoryDealGetInteger(deal,DEAL_MAGIC)!=InpMagicNumber)
         return(false);
     }
   return(true);
  }

bool HasForeignNettingExposure()
  {
   if(IsHedgingAccount())
      return(false);
   for(int i=0;i<PositionsTotal();i++)
     {
      if(PositionGetTicket(i)>0 && PositionGetString(POSITION_SYMBOL)==g_symbol &&
         !IsOwnPositionSelected())
         return(true);
     }
   for(int i=0;i<OrdersTotal();i++)
     {
      if(OrderGetTicket(i)>0 && OrderGetString(ORDER_SYMBOL)==g_symbol &&
         (long)OrderGetInteger(ORDER_MAGIC)!=InpMagicNumber)
         return(true);
     }
   return(false);
  }

bool HasOwnPendingOrder()
  {
   for(int i=0;i<OrdersTotal();i++)
     {
      if(OrderGetTicket(i)>0 && OrderGetString(ORDER_SYMBOL)==g_symbol &&
         (long)OrderGetInteger(ORDER_MAGIC)==InpMagicNumber)
         return(true);
     }
   return(false);
  }

bool ExecutionPermissionsAvailable()
  {
   if(!TradingExecutionEnabled() || !IsJustMarketsAccount())
      return(false);
   if(MQLInfoInteger(MQL_TESTER))
      return(true);
   return(TerminalInfoInteger(TERMINAL_CONNECTED) && TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) &&
          MQLInfoInteger(MQL_TRADE_ALLOWED) && AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) &&
          AccountInfoInteger(ACCOUNT_TRADE_EXPERT));
  }

double StoredCycleValue(const string suffix)
  {
   if(MQLInfoInteger(MQL_TESTER))
      return(0.0);
   string key=g_cycle_key+suffix;
   return(GlobalVariableCheck(key) ? GlobalVariableGet(key) : 0.0);
  }

void StoreCycleValue(const string suffix,const double value)
  {
   if(!MQLInfoInteger(MQL_TESTER))
      GlobalVariableSet(g_cycle_key+suffix,value);
  }

void InitializeCycleState()
  {
   uint hash=2166136261;
   string scope=AccountInfoString(ACCOUNT_SERVER)+"|"+g_symbol;
   for(int i=0;i<StringLen(scope);i++)
      hash=(hash^(uint)StringGetCharacter(scope,i))*16777619;
   g_cycle_key=StringFormat("JM_NB_%I64d_%I64d_%u",AccountInfoInteger(ACCOUNT_LOGIN),InpMagicNumber,hash);
   g_cycle_start=(datetime)StoredCycleValue("_start");
   g_last_cycle_end=(datetime)StoredCycleValue("_last");
   g_cycle_closing=StoredCycleValue("_close")>0.5;
   g_last_claimed_bar=(datetime)StoredCycleValue("_entrybar");
   if(!MQLInfoInteger(MQL_TESTER) && !GlobalVariableCheck(g_cycle_key+"_entrybar"))
      StoreCycleValue("_entrybar",0.0);
   SyncCycleState();
  }

bool ClaimEntryBar()
  {
   if(g_last_entry_bar<=0 || g_last_claimed_bar>=g_last_entry_bar)
      return(false);
   if(!MQLInfoInteger(MQL_TESTER))
     {
      double previous=StoredCycleValue("_entrybar");
      if(previous>=(double)g_last_entry_bar ||
         !GlobalVariableSetOnCondition(g_cycle_key+"_entrybar",(double)g_last_entry_bar,previous))
         return(false);
     }
   g_last_claimed_bar=g_last_entry_bar;
   return(true);
  }

void FinishCycle()
  {
   if(g_cycle_start==0 && !g_cycle_closing)
      return;
   g_last_cycle_end=ServerNow();
   g_cycle_start=0;
   g_cycle_closing=false;
   g_cycle_net_valid=false;
   StoreCycleValue("_start",0.0);
   StoreCycleValue("_close",0.0);
   StoreCycleValue("_last",(double)g_last_cycle_end);
   if(!MQLInfoInteger(MQL_TESTER))
      GlobalVariablesFlush();
   LogEvent("CYCLE_FINISHED",StringFormat("cooldown=%d",InpCycleCooldownSeconds));
  }

void SyncCycleState()
  {
   datetime earliest=0;
   for(int i=0;i<PositionsTotal();i++)
     {
      if(PositionGetTicket(i)==0 || !IsOwnPositionSelected())
         continue;
      datetime opened=(datetime)PositionGetInteger(POSITION_TIME);
      if(earliest==0 || opened<earliest)
         earliest=opened;
     }
   if(earliest>0)
     {
      if(g_cycle_start==0 || earliest<g_cycle_start)
        {
         g_cycle_start=earliest;
         StoreCycleValue("_start",(double)g_cycle_start);
        }
     }
   else if(!HasOwnPendingOrder())
      FinishCycle();
  }

bool IdInList(const ulong id,const ulong &ids[])
  {
   for(int i=0;i<ArraySize(ids);i++)
      if(ids[i]==id)
         return(true);
   return(false);
  }

void AddUniqueId(const ulong id,ulong &ids[])
  {
   if(id==0 || IdInList(id,ids))
      return;
   int count=ArraySize(ids);
   ArrayResize(ids,count+1);
   ids[count]=id;
  }

bool CycleNetEstimate(double &net)
  {
   net=0.0;
   if(g_cycle_start<=0)
      return(false);
   double floating=0.0,current_volume=0.0,booked=0.0,entry_cost=0.0,entry_volume=0.0;
   ulong ids[];
   for(int i=0;i<PositionsTotal();i++)
     {
      if(PositionGetTicket(i)==0 || !IsOwnPositionSelected())
         continue;
      floating+=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);
      current_volume+=PositionGetDouble(POSITION_VOLUME);
      AddUniqueId((ulong)PositionGetInteger(POSITION_IDENTIFIER),ids);
     }
   if(current_volume<=0.0 || !HistorySelect(g_cycle_start,ServerNow()))
      return(false);
   // Include already closed legs and partial closes in this cycle's target.
   for(int i=0;i<HistoryDealsTotal();i++)
     {
      ulong deal=HistoryDealGetTicket(i);
      long entry=HistoryDealGetInteger(deal,DEAL_ENTRY);
      if(HistoryDealGetString(deal,DEAL_SYMBOL)==g_symbol &&
         (long)HistoryDealGetInteger(deal,DEAL_MAGIC)==InpMagicNumber &&
         (entry==DEAL_ENTRY_IN || entry==DEAL_ENTRY_INOUT))
         AddUniqueId((ulong)HistoryDealGetInteger(deal,DEAL_POSITION_ID),ids);
     }
   for(int i=0;i<HistoryDealsTotal();i++)
     {
      ulong deal=HistoryDealGetTicket(i);
      if(HistoryDealGetString(deal,DEAL_SYMBOL)!=g_symbol ||
         !IdInList((ulong)HistoryDealGetInteger(deal,DEAL_POSITION_ID),ids))
         continue;
      double costs=HistoryDealGetDouble(deal,DEAL_COMMISSION)+HistoryDealGetDouble(deal,DEAL_FEE);
      booked+=HistoryDealGetDouble(deal,DEAL_PROFIT)+HistoryDealGetDouble(deal,DEAL_SWAP)+costs;
      long entry=HistoryDealGetInteger(deal,DEAL_ENTRY);
      if(entry==DEAL_ENTRY_IN || entry==DEAL_ENTRY_INOUT)
        {
         entry_volume+=HistoryDealGetDouble(deal,DEAL_VOLUME);
         entry_cost+=MathMax(0.0,-costs);
        }
     }
   if(entry_volume<=0.0)
      return(false); // Do not close on a cash estimate missing opening charges.
   double rate=MathMax(InpExitCostPerLot,entry_cost/entry_volume);
   net=SPNetAfterCosts(floating,booked,rate*current_volume,InpCloseBufferMoney);
   return(MathIsValidNumber(net));
  }

bool ManageSmallProfitCycle()
  {
   SyncCycleState();
   if(!InpUseSmallProfit && !g_cycle_closing)
      return(false);
   int positions=CountOwnPositions();
   if(positions==0 && !HasOwnPendingOrder())
      return(false);
   if(!g_cycle_closing)
     {
      MqlTick tick;
      bool fresh=SymbolInfoTick(g_symbol,tick) && tick.bid>0.0 && tick.ask>=tick.bid &&
                 ServerNow()-tick.time<=10 && tick.time<=ServerNow()+2;
      g_cycle_net_valid=CycleNetEstimate(g_cycle_net);
      if(SPTargetReached(positions,fresh,g_cycle_net_valid,g_cycle_net,InpBasketProfitTarget))
        {
         g_cycle_closing=true;
         StoreCycleValue("_close",1.0);
         if(!MQLInfoInteger(MQL_TESTER))
            GlobalVariablesFlush();
         LogEvent("SMALL_PROFIT_TRIGGER",StringFormat("estimated_net=%.2f,target=%.2f %s",
                                                      g_cycle_net,InpBasketProfitTarget,
                                                      AccountInfoString(ACCOUNT_CURRENCY)));
        }
     }
   if(g_cycle_closing)
     {
      // Latch the close request. A rejection/partial fill cannot start a new cycle.
      CloseCyclePositions("SMALL_PROFIT");
      SyncCycleState();
      return(true);
     }
   return(false);
  }

//+------------------------------------------------------------------+
//| Daily risk controls                                              |
//+------------------------------------------------------------------+
int CountTodayEntries()
  {
   datetime now=ServerNow();
   if(!HistorySelect(StartOfDay(now),now))
      return(InpMaxTradesPerDay); // Fail closed when the history cannot be read.

   int count=0;
   int total=HistoryDealsTotal();
   ulong orders[];
   for(int i=0;i<total;i++)
     {
      ulong ticket=HistoryDealGetTicket(i);
      if(ticket==0)
         continue;
      if((long)HistoryDealGetInteger(ticket,DEAL_MAGIC)!=InpMagicNumber ||
         HistoryDealGetString(ticket,DEAL_SYMBOL)!=g_symbol)
         continue;
      long entry=HistoryDealGetInteger(ticket,DEAL_ENTRY);
      if(entry==DEAL_ENTRY_IN || entry==DEAL_ENTRY_INOUT)
        {
         ulong order=(ulong)HistoryDealGetInteger(ticket,DEAL_ORDER);
         bool seen=false;
         for(int n=0;n<ArraySize(orders);n++)
            if(orders[n]==order) { seen=true; break; }
         if(!seen)
           {
            ArrayResize(orders,count+1);
            orders[count++]=order;
           }
        }
     }
   return(count);
  }

double GetTodayNet()
  {
   datetime now=ServerNow();
   double net=0.0;
   if(HistorySelect(StartOfDay(now),now))
     {
      int total=HistoryDealsTotal();
      for(int i=0;i<total;i++)
        {
         ulong ticket=HistoryDealGetTicket(i);
         if(ticket==0)
            continue;
         if((long)HistoryDealGetInteger(ticket,DEAL_MAGIC)!=InpMagicNumber ||
            HistoryDealGetString(ticket,DEAL_SYMBOL)!=g_symbol)
            continue;
         net+=HistoryDealGetDouble(ticket,DEAL_PROFIT);
         net+=HistoryDealGetDouble(ticket,DEAL_COMMISSION);
         net+=HistoryDealGetDouble(ticket,DEAL_SWAP);
         net+=HistoryDealGetDouble(ticket,DEAL_FEE);
        }
     }

   for(int i=0;i<PositionsTotal();i++)
     {
      ulong position_ticket=PositionGetTicket(i);
      if(position_ticket==0 || !PositionSelectByTicket(position_ticket))
         continue;
      if(IsOwnPositionSelected())
         net+=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);
     }
   return(net);
  }

bool DailyRiskLimitReached(string &reason)
  {
   int entries=CountTodayEntries();
   if(entries>=InpMaxTradesPerDay)
     {
      reason=StringFormat("daily trade limit reached (%d/%d)",entries,InpMaxTradesPerDay);
      return(true);
     }

   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double limit=equity*InpMaxDailyLossPercent/100.0;
   double today_net=GetTodayNet();
   if(limit>0.0 && today_net<=-limit)
     {
      reason=StringFormat("daily loss limit reached (%.2f <= -%.2f)",today_net,limit);
      return(true);
     }
   return(false);
  }

//+------------------------------------------------------------------+
//| Calendar and schedule filters                                   |
//+------------------------------------------------------------------+
bool IsHighImpactNewsWindow(string &reason)
  {
   reason="";
   if(!InpUseNewsFilter)
      return(false);

   datetime now=ServerNow();
   MqlCalendarValue values[];
   int found=CalendarValueHistory(values,
                                  now-InpNewsMinutesBefore*60,
                                  now+InpNewsMinutesAfter*60,
                                  "",
                                  InpNewsCurrency);
   if(found<0)
     {
      if(MQLInfoInteger(MQL_TESTER))
         return(false);
      if(InpBlockIfCalendarFails)
        {
         reason=StringFormat("economic calendar unavailable; trading blocked (error %d)",GetLastError());
         return(true);
        }
      return(false);
     }

   for(int i=0;i<found;i++)
     {
      MqlCalendarEvent event;
      if(!CalendarEventById(values[i].event_id,event))
         continue;
      if((int)event.importance>=InpMinimumNewsImportance)
        {
         reason=StringFormat("high-impact %s event near %s",
                             event.name,TimeToString(values[i].time,TIME_DATE|TIME_MINUTES));
         return(true);
        }
     }
   return(false);
  }

bool IsWithinTradingHours()
  {
   if(!InpUseTradingHours)
      return(true);

   MqlDateTime now_struct;
   TimeToStruct(ServerNow(),now_struct);
   int hour=now_struct.hour;
   if(InpTradeStartHour==InpTradeEndHour)
      return(true);
   if(InpTradeStartHour<InpTradeEndHour)
      return(hour>=InpTradeStartHour && hour<InpTradeEndHour);
   return(hour>=InpTradeStartHour || hour<InpTradeEndHour);
  }

//+------------------------------------------------------------------+
//| Support/resistance helpers                                      |
//+------------------------------------------------------------------+
double RecentLow(const int start_shift,const int count)
  {
   double result=1.0e100;
   for(int shift=start_shift;shift<start_shift+count;shift++)
     {
      double value=iLow(g_symbol,InpEntryTimeframe,shift);
      if(value>0.0 && value<result)
         result=value;
     }
   return(result==1.0e100 ? 0.0 : result);
  }

double RecentHigh(const int start_shift,const int count)
  {
   double result=-1.0e100;
   for(int shift=start_shift;shift<start_shift+count;shift++)
     {
      double value=iHigh(g_symbol,InpEntryTimeframe,shift);
      if(value>0.0 && value>result)
         result=value;
     }
   return(result==-1.0e100 ? 0.0 : result);
  }

//+------------------------------------------------------------------+
//| Risk-based volume                                                |
//+------------------------------------------------------------------+
double CalculateVolume(const ENUM_ORDER_TYPE order_type,const double entry,const double stop_loss)
  {
   if(InpRiskPercent<=0.0 || entry<=0.0 || stop_loss<=0.0)
      return(0.0);

   double risk_money=AccountInfoDouble(ACCOUNT_EQUITY)*InpRiskPercent/100.0;
   double daily_remaining=AccountInfoDouble(ACCOUNT_EQUITY)*InpMaxDailyLossPercent/100.0+GetTodayNet();
   risk_money=MathMin(risk_money,MathMax(0.0,daily_remaining));
   if(risk_money<=0.0)
      return(0.0);

   double one_lot_loss=0.0;
   if(!OrderCalcProfit(order_type,g_symbol,1.0,entry,stop_loss,one_lot_loss))
      return(0.0);
   one_lot_loss=MathAbs(one_lot_loss);
   if(one_lot_loss<=0.0)
      return(0.0);

   double raw_volume=risk_money/one_lot_loss;
   double min_volume=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN);
   double max_volume=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MAX);
   double step=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP);
   if(min_volume<=0.0 || max_volume<=0.0 || step<=0.0)
      return(0.0);

   if(raw_volume<min_volume)
      return(0.0); // Never exceed the requested risk just to satisfy the broker minimum.

   double volume=MathFloor(raw_volume/step)*step;
   volume=MathMin(volume,max_volume);
   volume=NormalizeDouble(volume,VolumeDigits(step));
   if(volume<min_volume)
      return(0.0);
   return(volume);
  }

bool MarginIsAcceptable(const ENUM_ORDER_TYPE order_type,const double entry,const double volume)
  {
   double margin=0.0;
   if(!OrderCalcMargin(order_type,g_symbol,volume,entry,margin))
      return(false);
   double free_margin=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   if(free_margin<=0.0)
      return(false);
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double used=AccountInfoDouble(ACCOUNT_MARGIN);
   return(equity>0.0 && margin<=free_margin &&
          used+margin<=equity*InpMaxMarginUsePercent/100.0);
  }

int VolumeDigits(const double step)
  {
   for(int digits=0;digits<=8;digits++)
     {
      double scaled=step*MathPow(10.0,digits);
      if(MathAbs(scaled-MathRound(scaled))<1.0e-8)
         return(digits);
     }
   return(8);
  }

double NormalizePrice(const double price)
  {
   return(NormalizeDouble(price,g_digits));
  }

double MinimumStopDistance()
  {
   long stops_level=SymbolInfoInteger(g_symbol,SYMBOL_TRADE_STOPS_LEVEL);
   long freeze_level=SymbolInfoInteger(g_symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   long level=MathMax(stops_level,freeze_level);
   return((double)level*g_point);
  }

//+------------------------------------------------------------------+
//| Chart status panel                                               |
//+------------------------------------------------------------------+
void UpdateChartPanel()
  {
   if(!InpShowChartPanel)
      return;

   double bias_fast=0.0,bias_slow=0.0,rsi=0.0,atr=0.0;
   ReadIndicatorValue(g_bias_fast_handle,1,bias_fast);
   ReadIndicatorValue(g_bias_slow_handle,1,bias_slow);
   ReadIndicatorValue(g_entry_rsi_handle,1,rsi);
   ReadIndicatorValue(g_entry_atr_handle,1,atr);

   string trend="NEUTRAL";
   if(bias_fast>bias_slow) trend="BULLISH";
   if(bias_fast<bias_slow) trend="BEARISH";

   MqlTick tick;
   double spread=0.0;
   if(SymbolInfoTick(g_symbol,tick) && g_point>0.0)
      spread=(tick.ask-tick.bid)/g_point;

   string state=IsEmergencyStopActive() ? "EMERGENCY STOP" :
                (MQLInfoInteger(MQL_TESTER) ? "TESTER" : (InpEnableLiveTrading ? "LIVE" : "SIGNALS ONLY"));
   string cycle=StringFormat("\nSmall-profit %s | Positions %d | Target %.2f %s | Net estimate %s\nCooldown %ds | Closing %s",
                             InpUseSmallProfit ? "ON" : "OFF",CountOwnPositions(),InpBasketProfitTarget,
                             AccountInfoString(ACCOUNT_CURRENCY),
                             g_cycle_net_valid ? DoubleToString(g_cycle_net,2) : "unavailable",
                             (int)MathMax(0,InpCycleCooldownSeconds-(ServerNow()-g_last_cycle_end)),
                             g_cycle_closing ? "YES" : "NO");
   string text=StringFormat("NABD JustMarkets MT5 v1.13\nSymbol: %s | State: %s\nTrend %s | RSI %.2f | ATR %.*f\nSpread %.1f pts | Today trades %d/%d | Today net %.2f\nRisk %.2f%% per cycle | RR %.2f | News filter %s\nEmergency key: %s",
                            g_symbol,state,trend,rsi,g_digits,atr,spread,CountTodayEntries(),InpMaxTradesPerDay,
                            GetTodayNet(),InpRiskPercent,InpRewardRisk,InpUseNewsFilter ? "ON" : "OFF",g_emergency_key);
   Comment(text+cycle);
  }

//+------------------------------------------------------------------+
//| CSV event log                                                    |
//+------------------------------------------------------------------+
void LogEvent(const string event_name,const string details)
  {
   int handle=FileOpen(InpLogFileName,FILE_READ|FILE_WRITE|FILE_CSV|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE,';');
   if(handle==INVALID_HANDLE)
     {
      PrintFormat("Log file open failed (%s), error=%d",InpLogFileName,GetLastError());
      return;
     }

   if(FileSize(handle)==0)
      FileWrite(handle,"time","symbol","event","details");
   FileSeek(handle,0,SEEK_END);
   FileWrite(handle,TimeToString(ServerNow(),TIME_DATE|TIME_SECONDS),g_symbol,event_name,details);
   FileClose(handle);
  }

bool IsSuccessfulRetcode(const uint retcode)
  {
   return(retcode==TRADE_RETCODE_DONE || retcode==TRADE_RETCODE_PLACED || retcode==TRADE_RETCODE_DONE_PARTIAL);
  }

datetime ServerNow()
  {
   datetime server_time=TimeTradeServer();
   if(server_time<=0)
      server_time=TimeCurrent();
   return(server_time);
  }

datetime StartOfDay(const datetime when)
  {
   MqlDateTime parts;
   TimeToStruct(when,parts);
   parts.hour=0;
   parts.min=0;
   parts.sec=0;
   return(StructToTime(parts));
  }

// Lightweight coordination only; network I/O runs in a separate bridge EA.
#include "NABD_Link.mqh"
