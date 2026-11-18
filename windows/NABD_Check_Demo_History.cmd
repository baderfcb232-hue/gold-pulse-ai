@echo off
setlocal
cd /d "%~dp0.."
echo ================================================
echo NABD PHASE 15 - READ-ONLY JUSTMARKETS DEMO CHECK
echo ================================================
echo No passwords or trade orders are requested.
echo If your symbols do not have .m suffix, edit the names below.
echo.
echo Checking XAUUSD.m history for two years...
python windows\nabd_phase15_preflight.py --market XAUUSD --symbol XAUUSD.m
echo.
echo Checking BTCUSD.m history for two years...
python windows\nabd_phase15_preflight.py --market BTCUSD --symbol BTCUSD.m
echo.
echo The diagnostics above show missing timeframe history.
echo OPEN M5, M15, H1, H4 charts in MT5 Demo, then run again.
echo.
pause
endlocal
