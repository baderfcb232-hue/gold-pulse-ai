#property strict
#property version   "4.04"
#property description "NABD BTC FUSION V2 Demo integrated EA 4.04: preflight BTC quote and safe execution."

#include <Trade/Trade.mqh>

CTrade g_trade;
const bool NABD_IS_BTC=true;
string g_integrated_status="Starting";

//--- strategy and symbol settings
input group "Market and timeframes"
input string          InpSymbol                 = "";          // Blank = chart symbol
input ENUM_TIMEFRAMES InpBiasTimeframe          = PERIOD_M15;  // Direction timeframe
input ENUM_TIMEFRAMES InpEntryTimeframe         = PERIOD_M5;   // Entry timeframe
input int             InpFastEmaPeriod          = 8;
input int             InpSlowEmaPeriod          = 21;
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
input bool            InpDemoWebsiteNoDailyLimits = false;      // IMPORTANT: leave OFF for Fusion risk/daily protections
input bool            InpDemoBrokerMinimumLot   = false;
input int             InpMaxConcurrentPositions = 1;         // Fusion safety default: one BTC position.
input double          InpMaxOpenRiskPercent     = 0.5;       // Fusion safety default: aggregate open stop-risk in percent
input double          InpRiskPercent            = 0.50;        // Equity stop risk for the whole cycle
input double          InpRewardRisk             = 1.00;        // Target = R multiple
input double          InpStopBufferAtr           = 0.20;
input double          InpMinStopAtr             = 0.50;
input double          InpMaxStopAtr             = 3.00;
input double          InpMaxMarginUsePercent    = 25.0;
input int             InpMaxTradesPerDay        = 3;          // Fusion V2 safety default. 0 is unlimited, NOT advised.
input double          InpMaxDailyLossPercent    = 2.0;
input int             InpMaxSpreadPoints        = 2500;
input int             InpDeviationPoints        = 30;
input long            InpMagicNumber            = 26092302;
input bool            InpEnableLiveTrading      = true;       // Explicit safety switch

//--- time and news protection
input group "Trading schedule and news"
input bool            InpUseTradingHours        = false;
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
input bool            InpUseBreakEven           = false;
input double          InpBreakEvenTriggerAtr    = 1.00;
input double          InpBreakEvenOffsetAtr     = 0.05;
input bool            InpUseAtrTrailing         = false;
input double          InpTrailingStartAtr       = 1.50;
input double          InpTrailingDistanceAtr    = 1.00;
input bool            InpCloseOnEmergencyStop   = true;

// Cash targets are in the account's deposit currency, not necessarily USD.
input group "Small-profit cycles"
input bool            InpUseSmallProfit         = false;
input double          InpBasketProfitTarget     = 1.00;        // Estimated net target for the whole cycle
input int             InpMaxBasketPositions     = 1;           // Hedging accounts; netting uses one order
input int             InpCycleCooldownSeconds   = 60;
input double          InpExitCostPerLot         = 0.00;        // Closing cost floor; entry fees also estimated
input double          InpCloseBufferMoney       = 0.10;        // Additional execution reserve

//--- logging and chart panel
input group "Operations"
input string          InpLogFileName            = "NABD_BTC_FUSION_V2.csv";
input bool            InpShowChartPanel         = true;

input group "NABD dashboard coordination (optional)"
input bool            InpEnableNABDLink          = true; // Share runtime settings with a separate bridge EA
input bool            InpNABDAllowRemoteControl  = true; // Accept pause/resume and managed-position controls
input bool            InpNABDDemoRecommendations = true; // JustMarkets Demo: wait for approved dashboard recommendation
input bool            InpNABDWebsiteRecommendations = true; // Fusion plans come from NABD website; NOT native MQL5 scalp

input group "Fusion V2 timed exit (Demo only)"
input bool            InpFusionTimeExitEnabled = true;        // Attempt close at 15min; stop/TP remain broker-side
input int             InpFusionMaxHoldMinutes  = 15;          // Configurable 5..15 minutes
string NABDKey(const string suffix);

input group "Integrated NABD connection"
input string InpNABDUrl="https://gold-pulse-ai.onrender.com";
input string InpNABDToken=""; // Copy the existing MT5 ingest token; never the dashboard password
input int InpNABDRefreshSeconds=3;
input int InpNABDRequestTimeoutMs=3000; // MT5 WebRequest timeout; does not guarantee uninterrupted server transport
input bool InpNABDSendAccount=true;
input int InpNABDServerUtcOffsetMinutes=2147483647;
void NBLOnTimer();
void NBBOnTimer();
double NBMainValue(const string suffix)
  {return GlobalVariableCheck(NABDKey(suffix))?GlobalVariableGet(NABDKey(suffix)):0.0;}
bool NBMainFresh()
  {double age=(double)TimeGMT()-NBMainValue("HB");return NBMainValue("HB")>0 && age>=-5 && age<=5;}
void NBStatus(const string status){g_integrated_status=status;}

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
datetime g_website_enabled_at = 0;
datetime g_fusion_enabled_at = 0;
datetime g_fusion_next_exit_attempt = 0;
// Diagnostics for the *current* website entry attempt only, never reused as a trade signal.
int      g_website_attempt_code = 0;
uint     g_website_attempt_retcode = 0;
ulong    g_website_attempt_deal_ticket = 0;

//--- function declarations
bool   CreateIndicatorHandles();
void   ReleaseIndicatorHandles();
bool   ReadIndicatorValue(const int handle,const int shift,double &value);
bool   IsNewEntryBar();
bool   TradingExecutionEnabled();
bool   BuildSignal(SignalData &signal);
bool   PlaceSignal(const SignalData &signal);
void   ManageOpenPositions();
void   ManageFusionMaxHold();
bool   IsEmergencyStopActive();
void   CloseOwnPositions();
bool   HasOwnPosition();
bool   ConcurrentWebsiteEntryAllowed(const double additional_risk=0.0);
int    CountOwnPositions();
int    CountTodayEntries();
double GetTodayNet();
bool   DailyRiskLimitReached(string &reason);
bool   IsHighImpactNewsWindow(string &reason);
bool   IsWithinTradingHours();
double RecentLow(const int start_shift,const int count);
double RecentHigh(const int start_shift,const int count);
bool DemoWebsiteNoDailyLimitsEnabled();
bool DemoBrokerMinimumLotEnabled();
double ExecutionRiskBudget(const ENUM_ORDER_TYPE order_type,const double entry,const double stop_loss);
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

   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
     {Print("NABD BTC 4.04 is a DEMO-only package.");return INIT_FAILED;}
   if(InpBiasTimeframe!=PERIOD_M15 || InpEntryTimeframe!=PERIOD_M5 ||
      InpFastEmaPeriod!=8 || InpSlowEmaPeriod!=21 || InpRsiPeriod!=14 || InpAtrPeriod!=14)
     {Print("Native scalp V1 requires M15/M5, EMA8/21, RSI14 and ATR14.");return INIT_PARAMETERS_INCORRECT;}
   if(!MQLInfoInteger(MQL_TESTER) && InpEnableNABDLink &&
      (StringLen(InpNABDToken)<32 || StringFind(InpNABDUrl,"https://")!=0 ||
       InpNABDRequestTimeoutMs<1000 || InpNABDRequestTimeoutMs>10000))
     {Print("Set the existing HTTPS dashboard URL and 32+ character MT5 ingest token. Timeout 1000..10000 ms.");return INIT_PARAMETERS_INCORRECT;}
   if(MQLInfoInteger(MQL_TESTER) && InpNABDWebsiteRecommendations)
     {Print("Website mode cannot run in Strategy Tester. Use a Demo forward test.");return INIT_FAILED;}
   string selected=StringLen(InpSymbol)>0?InpSymbol:_Symbol;
   string expected=NABD_IS_BTC?"BTCUSD":"XAUUSD";
   string upper=selected;StringToUpper(upper);
   if(StringFind(upper,expected)!=0 ||
      (StringLen(upper)>StringLen(expected) && StringFind("._#",StringSubstr(upper,StringLen(expected),1))<0))
     {Print("Wrong asset: attach this EA to "+expected+" with the exact broker suffix.");return INIT_PARAMETERS_INCORRECT;}

   if(InpNABDWebsiteRecommendations && (!InpNABDDemoRecommendations || InpEntryTimeframe!=PERIOD_M5))
     {Print("Website mode requires Demo recommendations and the M5 entry timeframe.");return INIT_PARAMETERS_INCORRECT;}
   if(InpFusionMaxHoldMinutes<5 || InpFusionMaxHoldMinutes>15)
     {Print("Fusion max-hold must be 5..15 minutes.");return INIT_PARAMETERS_INCORRECT;}
   g_website_enabled_at=InpNABDWebsiteRecommendations?TimeGMT():0;
   if(InpNABDDemoRecommendations && (AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO || !InpEnableNABDLink || !InpNABDAllowRemoteControl))
     {Print("Recommendation execution requires a Demo account, NABD link and remote control.");return INIT_PARAMETERS_INCORRECT;}
   if(!IsJustMarketsAccount())
     {
      Print("This EA requires a JustMarkets MT5 account. Check the server in account details.");
      return(INIT_FAILED);
     }
   if(!MathIsValidNumber(InpRiskPercent) || InpRiskPercent<=0.0 || InpRiskPercent>100.0 ||
      InpMaxTradesPerDay<0 || !MathIsValidNumber(InpMaxDailyLossPercent) ||
      InpMaxDailyLossPercent<=0.0 || InpMaxDailyLossPercent>100.0 ||
      !MathIsValidNumber(InpMaxMarginUsePercent) ||
      InpMaxMarginUsePercent<=0.0 || InpMaxMarginUsePercent>100.0 ||
      InpMaxBasketPositions<1 || InpMaxBasketPositions>20 ||
      InpMaxConcurrentPositions<1 || InpMaxConcurrentPositions>20 ||
      !MathIsValidNumber(InpMaxOpenRiskPercent) || InpMaxOpenRiskPercent<=0.0 || InpMaxOpenRiskPercent>100.0 ||
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

   if(InpFusionTimeExitEnabled && InpNABDWebsiteRecommendations)
     {
      string fusion_key=NABDKey("F2START");
      if(!GlobalVariableCheck(fusion_key)) GlobalVariableSet(fusion_key,(double)ServerNow());
      g_fusion_enabled_at=(datetime)(long)GlobalVariableGet(fusion_key);
     }
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

   if(InpNABDWebsiteRecommendations)
     {NABDClearSignal();NABDCheckComplete();UpdateChartPanel();return;}

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
   if(InpNABDDemoRecommendations)
     {LogEvent("WAIT_DASHBOARD","local signal published; waiting for matching Demo approval");return;}

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
   // These distributable EAs are Demo-only: never permit orders on a live account.
   // Keep the explicit trading switch as a prerequisite for Demo orders.
   return(MQLInfoInteger(MQL_TESTER) ||
     (InpEnableLiveTrading &&
      AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO &&
      IsJustMarketsAccount()));
  }

//+------------------------------------------------------------------+
//| Strategy signal construction                                     |
//+------------------------------------------------------------------+
// Native port of NABD *-SCALP-M5M15-V1 from repository c701cce.
// Pure price calculations; wrapper owns freshness, news, risk and execution.
double NSema(const MqlRates &rows[],const int period)
  {
   int n=ArraySize(rows);if(n<period)return 0;
   double v=0;for(int i=0;i<period;i++)v+=rows[i].close;v/=period;
   double alpha=2.0/(period+1);
   for(int i=period;i<n;i++)v=rows[i].close*alpha+v*(1-alpha);
   return v;
  }
double NSrsi(const MqlRates &rows[])
  {
   int n=ArraySize(rows);if(n<=14)return 0;
   double gain=0,loss=0;
   for(int i=1;i<=14;i++){double d=rows[i].close-rows[i-1].close;gain+=MathMax(d,0.0);loss+=MathMax(-d,0.0);}
   gain/=14;loss/=14;
   for(int i=15;i<n;i++){double d=rows[i].close-rows[i-1].close;gain=(gain*13+MathMax(d,0.0))/14;loss=(loss*13+MathMax(-d,0.0))/14;}
   return loss==0?(gain==0?50:100):100-100/(1+gain/loss);
  }
double NSatr(const MqlRates &rows[])
  {
   int n=ArraySize(rows);if(n<=14)return 0;
   double v=0;
   for(int i=1;i<n;i++)
     {
      double r=MathMax(rows[i].high-rows[i].low,MathMax(MathAbs(rows[i].high-rows[i-1].close),MathAbs(rows[i].low-rows[i-1].close)));
      if(i<=14)v+=r;
      if(i==14)v/=14;
      if(i>14)v=(v*13+r)/14;
     }
   return v;
  }
double NSalign(const double price,const double tick,const int digits,const int mode=0)
  {double q=price/tick;return NormalizeDouble((mode<0?MathFloor(q):mode>0?MathCeil(q):MathFloor(q+0.5))*tick,digits);}
bool NSScalpCore(const MqlRates &m5[],const MqlRates &m15[],const MqlRates &h4[],
 const bool btc,const double bid,const double ask,const double point,const double tick,
 const int digits,const double stops_points,const double gold_spread,SignalData &s)
  {
   s.direction=0;s.reason="Waiting for closed M5/M15/H4 bars";
   int n=ArraySize(m5),n15=ArraySize(m15),n4=ArraySize(h4);
   if(n<220 || n15<220 || n4<220 || bid<=0 || ask<bid || point<=0 || tick<=0)return false;
   double spread=ask-bid;
   double ceiling=btc?MathMax(1.0,MathFloor((ask+bid)*0.5*0.001/point)):gold_spread;
   s.spread_points=spread/point;
   if(s.spread_points>ceiling){s.reason="Spread exceeds instrument limit";return false;}
   s.atr=NSatr(m5);s.rsi=NSrsi(m5);s.bias_fast=NSema(m15,8);s.bias_slow=NSema(m15,21);
   s.entry_fast=NSema(m5,8);double slow5=NSema(m5,21),v=s.atr;
   if(!(v>0) || !MathIsValidNumber(s.rsi))return false;
   int direction=s.bias_fast>s.bias_slow && m15[n15-1].close>s.bias_slow?1:
                 s.bias_fast<s.bias_slow && m15[n15-1].close<s.bias_slow?-1:0;
   if(direction==0){s.reason="M15 EMA8/21 has no confirmed direction";return false;}
   bool buy=direction>0;
   double fast4=NSema(h4,8),slow4=NSema(h4,21),trend4=NSema(h4,200);
   int dir4=fast4>slow4 && h4[n4-1].close>trend4?1:fast4<slow4 && h4[n4-1].close<trend4?-1:0;
   bool opposite=dir4==-direction;
   bool trend5=buy?s.entry_fast>slow5 && m5[n-1].close>s.entry_fast:s.entry_fast<slow5 && m5[n-1].close<s.entry_fast;
   double boundary=buy?m5[n-2].high:m5[n-2].low;
   if(opposite)for(int i=n-4;i<=n-2;i++)boundary=buy?MathMax(boundary,m5[i].high):MathMin(boundary,m5[i].low);
   bool breaks=buy?m5[n-1].close>boundary:m5[n-1].close<boundary;
   double body_min=btc?(opposite?0.22:0.15):(opposite?0.20:0.12);
   bool candle=(buy?m5[n-1].close>m5[n-1].open:m5[n-1].close<m5[n-1].open) && breaks &&
               MathAbs(m5[n-1].close-m5[n-1].open)>=v*body_min;
   bool momentum=btc?(buy?s.rsi>=(opposite?57:51) && s.rsi<=76:s.rsi<=(opposite?43:49) && s.rsi>=24):
                     (buy?s.rsi>=(opposite?55:50) && s.rsi<=80:s.rsi>=20 && s.rsi<=(opposite?45:50));
   double price=buy?ask:bid;
   bool near=MathAbs(price-m5[n-1].close)<=v*0.6;
   bool costs=spread<=v*(btc?0.20:0.25);
   if(!trend5 || !candle || !momentum || !near || !costs)
     {s.reason="Waiting for M5 trend, breakout, RSI, entry distance or spread/ATR";return false;}
   double entry=NSalign(price,tick,digits),swing=buy?m5[n-1].low:m5[n-1].high;
   for(int i=n-5;i<n;i++)swing=buy?MathMin(swing,m5[i].low):MathMax(swing,m5[i].high);
   double buffer=btc?0.15:0.12;
   double distance=MathMax(v*(btc?0.9:0.8),MathMax(buy?entry-swing+v*buffer:swing-entry+v*buffer,stops_points*point+tick+spread));
   if(distance>v*(btc?2.8:2.5)){s.reason="Stop exceeds allowed ATR distance";return false;}
   double sl=NSalign(entry+(buy?-distance:distance),tick,digits,buy?-1:1);
   double risk=MathAbs(entry-sl);
   if(risk<=tick || sl<=0)return false;
   double tp=NSalign(entry+direction*risk,tick,digits);
   if(buy?!(sl<entry && entry<tp):!(tp<entry && entry<sl))return false;
   s.direction=direction;s.entry=entry;s.stop_loss=sl;s.take_profit=tp;
   s.reason=btc?"NABD-BTC-SCALP-M5M15-V1":"NABD-GOLD-SCALP-M5M15-V1";
   return true;
  }


bool BuildSignal(SignalData &signal)
  {
   ZeroMemory(signal);
   signal.reason="Waiting for native scalp setup";
   if(HasOwnPosition() || HasOwnPendingOrder() || HasForeignNettingExposure() || g_cycle_closing)return false;
   if(!IsWithinTradingHours()){signal.reason="Outside configured hours";return false;}
   if(DailyRiskLimitReached(signal.reason) || IsHighImpactNewsWindow(signal.reason))return false;
   MqlTick tick;
   if(!SymbolInfoTick(g_symbol,tick) || ServerNow()-tick.time>10 || tick.time>ServerNow()+2)
     {signal.reason="Stale broker tick";return false;}
   MqlRates m5[],m15[],h4[],h1[];
   ArraySetAsSeries(m5,false);ArraySetAsSeries(m15,false);ArraySetAsSeries(h4,false);
   int a=CopyRates(g_symbol,PERIOD_M5,1,320,m5),b=CopyRates(g_symbol,PERIOD_M15,1,320,m15),
       c=CopyRates(g_symbol,PERIOD_H4,1,320,h4);
   if(a<220 || b<220 || c<220){signal.reason="Need 220 closed M5/M15/H4 bars";return false;}
   if(!NABD_IS_BTC && CopyRates(g_symbol,PERIOD_H1,1,320,h1)<220)
     {signal.reason="Gold needs 220 H1 context bars";return false;}
   datetime now=ServerNow();
   if(now-m5[a-1].time-300>420 || now-m15[b-1].time-900>1020 || now-h4[c-1].time-14400>14520 ||
      m5[a-1].time+300>now+2 || m15[b-1].time+900>now+2 || h4[c-1].time+14400>now+2)
     {signal.reason="Closed candle history is stale or ahead of server time";return false;}
   return NSScalpCore(m5,m15,h4,NABD_IS_BTC,tick.bid,tick.ask,g_point,
     SymbolInfoDouble(g_symbol,SYMBOL_TRADE_TICK_SIZE),g_digits,
     (double)SymbolInfoInteger(g_symbol,SYMBOL_TRADE_STOPS_LEVEL),(double)InpMaxSpreadPoints,signal);
  }

//+------------------------------------------------------------------+
//| Order placement                                                  |
//+------------------------------------------------------------------+
// Reduce automatic volume for the fresh execution price, never enlarge it.
// Pure arithmetic: broker min/step and the original per-leg risk budget apply.
double BTCRiskCappedVolume(const double requested,const double exposure,const double budget,
                          const double minimum,const double step)
  {
   if(!MathIsValidNumber(requested) || !MathIsValidNumber(exposure) ||
      !MathIsValidNumber(budget) || !MathIsValidNumber(minimum) || !MathIsValidNumber(step) ||
      requested<minimum || minimum<=0.0 || step<=0.0 || exposure<=0.0 || budget<=0.0)return 0.0;
   if(exposure<=budget+1.0e-8)return requested;
   double target=requested*(budget/exposure);
   if(target<minimum-1.0e-10)return 0.0;
   double capped=minimum+MathFloor((target-minimum)/step+1.0e-9)*step;
   if(capped<minimum-1.0e-10 || capped>requested || exposure*(capped/requested)>budget+1.0e-8)return 0.0;
   return capped;
  }

bool PlaceSignal(const SignalData &signal)
  {
   g_website_attempt_code=0;g_website_attempt_retcode=0;g_website_attempt_deal_ticket=0;
   if(!ExecutionPermissionsAvailable() ||
      (!DemoWebsiteNoDailyLimitsEnabled() && HasOwnPosition()) ||
      (DemoWebsiteNoDailyLimitsEnabled() && !ConcurrentWebsiteEntryAllowed()) ||
      HasOwnPendingOrder() || HasForeignNettingExposure() || g_cycle_closing)
     {g_website_attempt_code=116;return(false);}

   ENUM_ORDER_TYPE order_type=(signal.direction>0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
   double total_volume=CalculateVolume(order_type,signal.entry,signal.stop_loss);
   bool manual_website=InpNABDWebsiteRecommendations && AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO &&
                       GlobalVariableCheck(NABDKey("WV")) && GlobalVariableGet(NABDKey("WV"))>0.0;
   if(manual_website)
     {
      double requested=GlobalVariableGet(NABDKey("WV"));
      double vmin=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN);
      double vmax=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MAX);
      double vstep=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP);
      if(vstep<=0) {g_website_attempt_code=122;return(false);}
      double steps=(requested-vmin)/vstep;
      if(requested<vmin-1.0e-8 || requested>vmax+1.0e-8 ||
         MathAbs(steps-MathRound(steps))>1.0e-5)
        {g_website_attempt_code=122;LogEvent("ORDER_BLOCKED","invalid manual lot");return(false);}
      total_volume=requested;
     }
   double minimum=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN);
   double step=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP);
   int remaining=(DemoWebsiteNoDailyLimitsEnabled() || InpMaxTradesPerDay==0) ? 1 : InpMaxTradesPerDay-CountTodayEntries();
   int legs=SPPlanLegCount(DemoWebsiteNoDailyLimitsEnabled() ? 1 : (InpUseSmallProfit ? InpMaxBasketPositions : 1),
                          remaining,IsHedgingAccount(),total_volume,minimum);
   double volume=SPVolumePerLeg(total_volume,legs,minimum,step);
   volume=NormalizeDouble(volume,VolumeDigits(step));
   if(volume<=0.0 || legs<1)
     {
      Print("Order skipped: calculated volume is below broker minimum or invalid.");
      LogEvent("ORDER_BLOCKED","volume calculation failed");
      g_website_attempt_code=117;
      return(false);
     }

   string side=(signal.direction>0 ? "BUY" : "SELL");
   string comment=StringFormat("NABD_BTC_%s",side);
   // The broker Deal/History comment carries the exact website approval ID
   // for operator audit. The source-specific EA magic is still authoritative.
   if(InpNABDWebsiteRecommendations && GlobalVariableCheck(NABDKey("WA")) &&
      GlobalVariableGet(NABDKey("WA"))>0)
      comment=StringFormat("NABD_BTC_W%.0f",GlobalVariableGet(NABDKey("WA")));
   // Minimum-lot fallback is demo-only and remains capped by the daily allowance.
   double budget=ExecutionRiskBudget(order_type,signal.entry,signal.stop_loss);
   double risk_per_leg=budget/legs;
   double actual_volume=0.0;
   int accepted=0;
   // Website recommendations have a durable unique plan-id claim in PostgreSQL and MT5.
   // A bar-only gate would silently drop a different approved plan in the same M5 bar.
   if(!InpNABDWebsiteRecommendations && !ClaimEntryBar())
     {g_website_attempt_code=118;return(false);}
   for(int leg=0;leg<legs;leg++)
     {
      MqlTick tick;
      if(!SymbolInfoTick(g_symbol,tick) || tick.ask<=0.0 || tick.bid<=0.0 ||
         tick.ask<tick.bid || ServerNow()-tick.time>10 || tick.time>ServerNow()+2 ||
         (tick.ask-tick.bid)/g_point>InpMaxSpreadPoints || IsEmergencyStopActive())
        {g_website_attempt_code=119;break;}
      double price=signal.direction>0 ? tick.ask : tick.bid;
      double distance=signal.direction>0 ? tick.bid-signal.stop_loss : signal.stop_loss-tick.ask;
      double profit=0.0;
      double allowed_risk=(DemoBrokerMinimumLotEnabled() && legs==1 && volume<=minimum+1.0e-9)
         ? ExecutionRiskBudget(order_type,price,signal.stop_loss) : risk_per_leg;
      if(manual_website)allowed_risk=AccountInfoDouble(ACCOUNT_EQUITY);
      if(DemoWebsiteNoDailyLimitsEnabled() && !ConcurrentWebsiteEntryAllowed())
        {g_website_attempt_code=123;break;}
      // Preserve the same protective checks and order: only distinguish the exact
      // reason an entry was blocked. Never raise risk limits or force broker minimums.
      int safety_code=0;
      string safety_reason="";
      if(distance<=MinimumStopDistance())
        {safety_code=125;safety_reason="Stop distance below broker minimum";}
      else if(!OrderCalcProfit(order_type,g_symbol,volume,price,signal.stop_loss,profit))
        {safety_code=126;safety_reason="Broker stop-loss profit calculation failed";}
      if(safety_code==0 && MathAbs(profit)>allowed_risk+1.0e-8)
        {
         double before=volume;
         double resized=manual_website ? 0.0 : BTCRiskCappedVolume(volume,MathAbs(profit),allowed_risk,minimum,step);
         resized=NormalizeDouble(resized,VolumeDigits(step));
         if(resized>=minimum && resized<volume)
           {
            volume=resized;
            LogEvent("LOT_REDUCED",StringFormat("price=%.*f,SL=%.*f,lot_before=%.8f,lot_after=%.8f,risk_budget=%.2f",
               g_digits,price,g_digits,signal.stop_loss,before,volume,allowed_risk));
            if(!OrderCalcProfit(order_type,g_symbol,volume,price,signal.stop_loss,profit))
              {safety_code=126;safety_reason="Broker stop-loss calculation failed after lot reduction";}
           }
         else
           {safety_code=127;safety_reason="No permitted broker lot fits fresh-price stop risk";}
         if(safety_code==0 && MathAbs(profit)>allowed_risk+1.0e-8)
           {safety_code=127;safety_reason="Fresh-price stop risk exceeds budget after reduction";}
        }
      if(safety_code==0 && DemoWebsiteNoDailyLimitsEnabled() && !ConcurrentWebsiteEntryAllowed(MathMax(0.0,-profit)))
        {safety_code=128;safety_reason="Aggregate open-position risk cap or hedging protection";}
      else if(safety_code==0 && !MarginIsAcceptable(order_type,price,volume))
        {safety_code=129;safety_reason="Insufficient free margin or maximum margin-use cap";}
      if(safety_code>0)
        {
         LogEvent("ORDER_BLOCKED",StringFormat(
            "reason_code=%d,%s,price=%.*f,SL=%.*f,distance=%.8f,min_stop=%.8f,lot=%.8f,SL_loss=%.2f,risk_budget=%.2f,equity=%.2f,free_margin=%.2f,used_margin=%.2f,margin_cap_pct=%.2f",
            safety_code,safety_reason,g_digits,price,g_digits,signal.stop_loss,distance,MinimumStopDistance(),
            volume,MathAbs(profit),allowed_risk,AccountInfoDouble(ACCOUNT_EQUITY),
            AccountInfoDouble(ACCOUNT_MARGIN_FREE),AccountInfoDouble(ACCOUNT_MARGIN),InpMaxMarginUsePercent));
         g_website_attempt_code=safety_code;
         break;
        }
      datetime started=ServerNow();
      bool request_ok=signal.direction>0 ?
         g_trade.Buy(volume,g_symbol,0.0,signal.stop_loss,signal.take_profit,comment) :
         g_trade.Sell(volume,g_symbol,0.0,signal.stop_loss,signal.take_profit,comment);
      uint retcode=g_trade.ResultRetcode();
      g_website_attempt_retcode=retcode;
      bool ok=request_ok && IsSuccessfulRetcode(retcode);
      // A broker deal ticket (not the order acceptance) is actual fill evidence.
      if(ok && retcode==TRADE_RETCODE_DONE && g_trade.ResultDeal()>0)
         g_website_attempt_deal_ticket=g_trade.ResultDeal();
      if(!ok)g_website_attempt_code=121;
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
   ManageFusionMaxHold();
   if(!ExecutionPermissionsAvailable())
      return;
   if(IsEmergencyStopActive())
      return;
   if(DemoWebsiteNoDailyLimitsEnabled())
     {
      SyncCycleState();
      if(g_cycle_closing)CloseCyclePositions("PREVIOUS_CLOSE_REQUEST");
      return; // Website trade keeps its original broker-side SL and TP1.
     }
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
//| Fusion V2: close managed Demo BTC positions after timed hold     |
//+------------------------------------------------------------------+
void ManageFusionMaxHold()
  {
   if(!InpFusionTimeExitEnabled || !InpNABDWebsiteRecommendations ||
      !ExecutionPermissionsAvailable() || IsEmergencyStopActive() ||
      g_fusion_enabled_at<=0) return;
   datetime now=ServerNow();
   if(now<=0 || now<g_fusion_next_exit_attempt) return;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !PositionSelectByTicket(ticket) || !IsOwnPositionSelected())continue;
      datetime opened=(datetime)PositionGetInteger(POSITION_TIME);
      if(opened<g_fusion_enabled_at || opened>now ||
         now-opened<InpFusionMaxHoldMinutes*60)continue;
      g_fusion_next_exit_attempt=now+3;
      bool sent=g_trade.PositionClose(ticket,InpDeviationPoints);
      uint retcode=g_trade.ResultRetcode();
      bool closed=sent && retcode==TRADE_RETCODE_DONE && !PositionSelectByTicket(ticket);
      LogEvent(closed?"FUSION_TIME_EXIT_CLOSED":"FUSION_TIME_EXIT_RETRY",
               StringFormat("ticket=%I64u,age_sec=%I64d,retcode=%u,%s",ticket,
                            (long)(now-opened),retcode,g_trade.ResultRetcodeDescription()));
      if(!closed)PrintFormat("Fusion time exit not confirmed: ticket=%I64u retcode=%u",ticket,retcode);
      return;
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

// Account-wide protective limit: each already open position needs a valid stop.
// Never permit parallel orders on a netting account, where stops/ownership merge.
bool ConcurrentWebsiteEntryAllowed(const double additional_risk)
  {
   // A netting account may open its first order, but cannot hold independent
   // overlapping recommendations on the same symbol without merging stops.
   if(!IsHedgingAccount() && CountOwnPositions()>0)return false;
   int count=0;
   double risk=0.0;
   for(int i=0;i<PositionsTotal();i++)
     {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !PositionSelectByTicket(ticket))continue;
      count++;
      double stop=PositionGetDouble(POSITION_SL),volume=PositionGetDouble(POSITION_VOLUME);
      double entry=PositionGetDouble(POSITION_PRICE_OPEN),loss=0.0;
      ENUM_ORDER_TYPE kind=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
      if(stop<=0.0 || volume<=0.0 || !OrderCalcProfit(kind,PositionGetString(POSITION_SYMBOL),volume,entry,stop,loss))
        {LogEvent("ORDER_BLOCKED","Open position without reliable stop/risk");return false;}
      risk+=MathMax(0.0,-loss);
     }
   if(count>=InpMaxConcurrentPositions)
     {LogEvent("ORDER_BLOCKED","Account concurrent position cap reached");return false;}
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   if(equity<=0.0 || risk+additional_risk>=equity*InpMaxOpenRiskPercent/100.0)
     {LogEvent("ORDER_BLOCKED","Existing aggregate stop risk reached account cap");return false;}
   return true;
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
      GlobalVariablesFlush(); // Persist the bar claim before any broker request.
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
      return(InpMaxTradesPerDay); // DailyRiskLimitReached() separately blocks orders when history is unavailable.

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
   if(DemoWebsiteNoDailyLimitsEnabled()){reason="";return false;}
   // Do not bypass the 2% daily loss guard when unlimited daily entries are enabled.
   if(!HistorySelect(StartOfDay(ServerNow()),ServerNow()))
     {reason="Daily history unavailable; cannot validate daily loss";return(true);}
   int entries=CountTodayEntries();
   if(InpMaxTradesPerDay>0 && entries>=InpMaxTradesPerDay)
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
bool DemoWebsiteNoDailyLimitsEnabled()
  {
   return InpDemoWebsiteNoDailyLimits && InpEnableNABDLink && InpNABDDemoRecommendations &&
      InpNABDWebsiteRecommendations && InpNABDAllowRemoteControl &&
      AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO && IsJustMarketsAccount();
  }
bool DemoBrokerMinimumLotEnabled()
  {
   return InpDemoBrokerMinimumLot &&
      AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO && IsJustMarketsAccount();
  }
double ExecutionRiskBudget(const ENUM_ORDER_TYPE order_type,const double entry,const double stop_loss)
  {
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double daily=MathMax(0.0,equity*InpMaxDailyLossPercent/100.0+GetTodayNet());
   double budget=equity*InpRiskPercent/100.0;
   if(DemoBrokerMinimumLotEnabled())
     {
      double minimum=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN),loss=0.0;
      if(minimum<=0.0 || !OrderCalcProfit(order_type,g_symbol,minimum,entry,stop_loss,loss))return 0.0;
      budget=MathMax(budget,MathAbs(loss));
     }
   return DemoWebsiteNoDailyLimitsEnabled() ? budget : MathMin(budget,daily);
  }
double CalculateVolume(const ENUM_ORDER_TYPE order_type,const double entry,const double stop_loss)
  {
   if(InpRiskPercent<=0.0 || entry<=0.0 || stop_loss<=0.0)
      return(0.0);

   double risk_money=ExecutionRiskBudget(order_type,entry,stop_loss);
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

   if(raw_volume+1.0e-10<min_volume)
      return(0.0); // Daily allowance or strict risk mode cannot fund the minimum.

   double volume=MathFloor(raw_volume/step+1.0e-9)*step;
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
     {LogEvent("ORDER_BLOCKED",StringFormat("Margin calculation failed,error=%d,lot=%.8f,price=%.8f",GetLastError(),volume,entry));return(false);}
   LogEvent("MARGIN_CHECK",StringFormat("required=%.2f,free=%.2f,used=%.2f,cap=%.2f",margin,
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_EQUITY)*InpMaxMarginUsePercent/100.0));
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
   string text=StringFormat("NABD BTC integrated Demo v4.04\nSymbol: %s | State: %s\nTrend %s | RSI %.2f | ATR %.*f\nSpread %.1f pts | Today trades %d/%s | Today net %.2f\nRisk %.2f%% per cycle | RR %.2f | News filter %s\nEmergency key: %s",
                            g_symbol,state,trend,rsi,g_digits,atr,spread,CountTodayEntries(),InpMaxTradesPerDay==0?"unlimited":IntegerToString(InpMaxTradesPerDay),
                            GetTodayNet(),InpRiskPercent,InpRewardRisk,InpUseNewsFilter ? "ON" : "OFF",g_emergency_key);
   Comment(text+cycle+"\nMode: "+(InpNABDWebsiteRecommendations?"NABD website recommendations":"Native local scalp")+"\nBridge: "+g_integrated_status);
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
   // Surface website/entry rejection in MT5 Experts as well as CSV for operator diagnosis.
   if(event_name=="WEBSITE_BLOCKED" || event_name=="ORDER_BLOCKED" || event_name=="WEBSITE_SUBMITTED")
      PrintFormat("NABD %s | %s | %s",event_name,g_symbol,details);
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

// Integrated main, native strategy and bridge; no external NABD includes required.
// Integrated terminal coordination.
uint NABDHash(const string s)
  {uint h=2166136261;for(int i=0;i<StringLen(s);i++)h=(h^(uint)StringGetCharacter(s,i))*16777619;return h;}
string NABDKey(const string suffix)
  {return StringFormat("NB_%I64d_%I64d_%u_%s",AccountInfoInteger(ACCOUNT_LOGIN),InpMagicNumber,NABDHash(g_symbol),suffix);}
bool NABDRemotePaused()
  {return InpEnableNABDLink && InpNABDAllowRemoteControl && GlobalVariableCheck(NABDKey("P")) && GlobalVariableGet(NABDKey("P"))>0.5;}
void NABDClearSignal()
  {if(InpEnableNABDLink && !MQLInfoInteger(MQL_TESTER))GlobalVariableSet(NABDKey("ST"),0.0);}
void NABDCheckComplete()
  {if(InpEnableNABDLink && !MQLInfoInteger(MQL_TESTER))GlobalVariableSet(NABDKey("CHK"),(double)TimeGMT());}
void NABDPublishSignal(const SignalData &signal)
  {
   if(!InpEnableNABDLink || MQLInfoInteger(MQL_TESTER) || signal.direction==0)return;
   // ST=0 invalidates the record while fields are written; publish the timestamp last.
   GlobalVariableSet(NABDKey("ST"),0.0);
   GlobalVariableSet(NABDKey("DR"),0.0);
   GlobalVariableSet(NABDKey("SD"),(double)signal.direction);
   GlobalVariableSet(NABDKey("SB"),(double)g_last_entry_bar);
   GlobalVariableSet(NABDKey("SE"),signal.entry);
   GlobalVariableSet(NABDKey("SSL"),signal.stop_loss);
   GlobalVariableSet(NABDKey("STP"),signal.take_profit);
   GlobalVariableSet(NABDKey("SR"),signal.rsi);
   GlobalVariableSet(NABDKey("SA"),signal.atr);
   NABDCheckComplete();
   GlobalVariableSet(NABDKey("ST"),(double)TimeGMT());
  }
// The bridge never submits entries. Approval is consumed by the main EA on its own timer.
void NABDProcessDemoApproval()
  {
   if(InpNABDWebsiteRecommendations)return;
   if(!InpNABDDemoRecommendations || AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO ||
      !IsJustMarketsAccount() || !TradingExecutionEnabled() || !InpNABDAllowRemoteControl ||
      NABDRemotePaused() || IsEmergencyStopActive())return;
   double issued=GlobalVariableCheck(NABDKey("DA"))?GlobalVariableGet(NABDKey("DA")):0.0;
   double consumed=GlobalVariableCheck(NABDKey("DC"))?GlobalVariableGet(NABDKey("DC")):0.0;
   if(issued<=0 || issued<=consumed)return;
   double expiry=GlobalVariableGet(NABDKey("DX")),bar=GlobalVariableGet(NABDKey("DB"));
   double entry=GlobalVariableGet(NABDKey("DE")),sl=GlobalVariableGet(NABDKey("DSL")),tp=GlobalVariableGet(NABDKey("DTP"));
   int direction=(int)GlobalVariableGet(NABDKey("DD"));
   if(issued!=GlobalVariableGet(NABDKey("DA")))return;
   // Consume before validation/order submission. Never retry an uncertain request.
   GlobalVariableSet(NABDKey("DC"),issued);GlobalVariablesFlush();
   GlobalVariableSet(NABDKey("DR"),3.0);
   if(issued>(double)TimeGMT()+5 || (double)TimeGMT()-issued>75 || expiry<(double)TimeGMT() ||
      expiry>(double)TimeGMT()+20 || bar!=(double)g_last_entry_bar ||
      bar!=GlobalVariableGet(NABDKey("SB")) || issued!=GlobalVariableGet(NABDKey("ST")) ||
      direction!=(int)GlobalVariableGet(NABDKey("SD")) ||
      MathAbs(entry-GlobalVariableGet(NABDKey("SE")))>g_point*0.1 ||
      MathAbs(sl-GlobalVariableGet(NABDKey("SSL")))>g_point*0.1 ||
      (direction>0 ? !(sl<entry && entry<tp && tp<=GlobalVariableGet(NABDKey("STP"))) :
                      !(tp<entry && entry<sl && tp>=GlobalVariableGet(NABDKey("STP")))) ||
      g_cycle_closing || (InpUseSmallProfit && g_last_cycle_end>0 && ServerNow()-g_last_cycle_end<InpCycleCooldownSeconds))
     {LogEvent("DEMO_BLOCKED","expired or mismatched approval, invalid target or cycle cooldown");return;}
   SignalData checked;
   if(!BuildSignal(checked) || checked.direction!=direction)
     {LogEvent("DEMO_BLOCKED","local conditions changed: "+checked.reason);return;}
   MqlTick tick;
   if(!SymbolInfoTick(g_symbol,tick) || ServerNow()-tick.time>10 || tick.time>ServerNow()+2 ||
      MathAbs((direction>0?tick.ask:tick.bid)-entry)>MathAbs(entry-sl)*0.15)
     {LogEvent("DEMO_BLOCKED","price moved after recommendation");return;}
   checked.entry=entry;checked.stop_loss=sl;checked.take_profit=tp;
   bool accepted=PlaceSignal(checked);
   GlobalVariableSet(NABDKey("DR"),accepted?2.0:3.0);
   LogEvent(accepted?"DEMO_SUBMITTED":"DEMO_BLOCKED","approved recommendation; inspect order/deal retcodes for actual execution");
  }
// BEGIN WEBSITE_PLAN_GUARD
bool NABDWebsitePlanValid(const double now,const double since,const double issued,const double expiry,
 const double bar,const double closed_bar,const int direction,const double entry,const double sl,const double tp,
 const double bid,const double ask,const double point,const double max_spread,const double stop_distance)
  {
   if(!MathIsValidNumber(entry) || !MathIsValidNumber(sl) || !MathIsValidNumber(tp) ||
      !MathIsValidNumber(bid) || !MathIsValidNumber(ask) || !MathIsValidNumber(point) ||
      entry<=0 || sl<=0 || tp<=0 || bid<=0 || ask<bid || point<=0 || since<=0 || issued<since ||
      issued>now+5 || now-issued>75 || expiry<=now || expiry>now+20 || bar<=0 || bar!=closed_bar ||
      (direction!=1 && direction!=-1) || (ask-bid)/point>max_spread)return false;
   if(direction>0 ? !(sl<entry && entry<tp && bid>sl && bid<tp && bid-sl>stop_distance && tp-bid>stop_distance)
                  : !(tp<entry && entry<sl && ask<sl && ask>tp && sl-ask>stop_distance && ask-tp>stop_distance))return false;
   // Favorable BTC price improvement preserves or reduces fixed SL risk.
   // Adverse movement remains limited to 15%; better prices up to 30% are
   // allowed only while broker stop/spread checks above remain valid.
   double drift=((direction>0?ask:bid)-entry)*(direction>0?1.0:-1.0);
   double risk=MathAbs(entry-sl);
   return drift<=risk*0.15 && drift>=-risk*0.30;
  }
// END WEBSITE_PLAN_GUARD
void NABDWebsiteBlocked(const double id,const string reason,const int code,const uint retcode=0)
  {
   // Publish all rejection details BEFORE the result id so the bridge never
   // associates an earlier order's MT5 retcode with a later recommendation.
   GlobalVariableSet(NABDKey("WDT"),0.0);
   GlobalVariableSet(NABDKey("WRC"),(double)code);
   GlobalVariableSet(NABDKey("WRT"),(double)retcode);
   GlobalVariableSet(NABDKey("WR"),1.0);GlobalVariableSet(NABDKey("WI"),id);GlobalVariablesFlush();
   LogEvent("WEBSITE_BLOCKED",StringFormat("approval=%.0f,reason_code=%d,retcode=%u,%s",
     id,code,retcode,reason));
  }
void NABDProcessWebsiteApproval()
  {
   if(!InpNABDWebsiteRecommendations || !InpNABDDemoRecommendations ||
      AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO || !IsJustMarketsAccount())return;
   double id=GlobalVariableCheck(NABDKey("WA"))?GlobalVariableGet(NABDKey("WA")):0;
   double previous=GlobalVariableGet(NABDKey("WC"));
   if(id<=0 || id<=previous || id!=MathFloor(id) || id>9007199254740991.0)return;
   if(!GlobalVariableSetOnCondition(NABDKey("WC"),id,previous))return;
   GlobalVariablesFlush(); // Claim BEFORE validation/order; never retry an uncertain entry.
   GlobalVariableSet(NABDKey("WI"),0.0); // Result identifier is published LAST after validation/submission.
   GlobalVariableSet(NABDKey("WDT"),0.0);
   GlobalVariableSet(NABDKey("WRC"),0.0);GlobalVariableSet(NABDKey("WRT"),0.0);
   if(!TradingExecutionEnabled()){NABDWebsiteBlocked(id,"trading execution switch is off",101);return;}
   if(!ExecutionPermissionsAvailable()){NABDWebsiteBlocked(id,"terminal/account trade permissions unavailable",102);return;}
   if(!InpNABDAllowRemoteControl || NABDRemotePaused())
     {NABDWebsiteBlocked(id,"website remote control disabled or paused",103);return;}
   if(IsEmergencyStopActive()){NABDWebsiteBlocked(id,"emergency stop active",104);return;}
   if((!DemoWebsiteNoDailyLimitsEnabled() && HasOwnPosition()) ||
      (DemoWebsiteNoDailyLimitsEnabled() && !ConcurrentWebsiteEntryAllowed()) ||
      HasOwnPendingOrder() || HasForeignNettingExposure())
     {NABDWebsiteBlocked(id,"parallel entry incompatible with hedging, account exposure limit, or pending order",105);return;}
   if(g_cycle_closing){NABDWebsiteBlocked(id,"previous cycle is closing",106);return;}
   if(!IsWithinTradingHours()){NABDWebsiteBlocked(id,"outside allowed trading hours",107);return;}
   if(!DemoWebsiteNoDailyLimitsEnabled() && InpUseSmallProfit && g_last_cycle_end>0 &&
      ServerNow()-g_last_cycle_end<InpCycleCooldownSeconds)
     {NABDWebsiteBlocked(id,"cycle cooldown active",108);return;}
   string reason="";
   if(DailyRiskLimitReached(reason)){NABDWebsiteBlocked(id,reason,109);return;}
   if(IsHighImpactNewsWindow(reason)){NABDWebsiteBlocked(id,reason,110);return;}
   int direction=(int)GlobalVariableGet(NABDKey("WD"));
   double entry=GlobalVariableGet(NABDKey("WE")),sl=GlobalVariableGet(NABDKey("WL")),tp=GlobalVariableGet(NABDKey("WP"));
   MqlTick tick;
   if(!SymbolInfoTick(g_symbol,tick) || ServerNow()-tick.time>10 || tick.time>ServerNow()+2)
     {NABDWebsiteBlocked(id,"broker tick stale or unavailable",111);return;}
   if(!NABDWebsitePlanValid((double)TimeGMT(),(double)g_website_enabled_at,
       GlobalVariableGet(NABDKey("WF")),GlobalVariableGet(NABDKey("WX")),GlobalVariableGet(NABDKey("WB")),
       (double)iTime(g_symbol,PERIOD_M5,1),direction,entry,sl,tp,tick.bid,tick.ask,g_point,
       (double)InpMaxSpreadPoints,MinimumStopDistance()))
     {NABDWebsiteBlocked(id,"approval expired, candle mismatch, entry moved or invalid stops/spread",112);return;}
   SignalData signal;ZeroMemory(signal);
   signal.direction=direction;signal.entry=entry;signal.stop_loss=sl;signal.take_profit=tp;
   if(!ReadIndicatorValue(g_entry_atr_handle,1,signal.atr) || signal.atr<=0)
     {NABDWebsiteBlocked(id,"ATR not ready for position management",113);return;}
   signal.reason="NABD website BTC recommendation";
   g_last_entry_bar=iTime(g_symbol,PERIOD_M5,0);
   bool accepted=PlaceSignal(signal);
   if(!accepted)
     {
      NABDWebsiteBlocked(id,"PlaceSignal declined or broker returned a rejection",
        g_website_attempt_code>0?g_website_attempt_code:115,g_website_attempt_retcode);
      return;
     }
   GlobalVariableSet(NABDKey("WDT"),(double)g_website_attempt_deal_ticket);
   GlobalVariableSet(NABDKey("WRC"),0.0);
   GlobalVariableSet(NABDKey("WRT"),(double)g_website_attempt_retcode);
   GlobalVariableSet(NABDKey("WR"),2.0);GlobalVariableSet(NABDKey("WI"),id);GlobalVariablesFlush();
   LogEvent("WEBSITE_SUBMITTED",StringFormat("approval=%.0f,retcode=%u; verify deal in History",
     id,g_website_attempt_retcode));
  }
void NBLOnTimer()
  {
   if(!InpEnableNABDLink || MQLInfoInteger(MQL_TESTER))return;
   if(!GlobalVariableCheck(NABDKey("WC")))GlobalVariableSet(NABDKey("WC"),0.0);
   GlobalVariableSet(NABDKey("L"),TradingExecutionEnabled()?1.0:0.0);
   GlobalVariableSet(NABDKey("R"),InpNABDAllowRemoteControl?1.0:0.0);
   GlobalVariableSet(NABDKey("TP"),InpUseSmallProfit?InpBasketProfitTarget:0.0);
   GlobalVariableSet(NABDKey("DL"),InpMaxDailyLossPercent);
   GlobalVariableSet(NABDKey("RP"),InpRiskPercent);
   GlobalVariableSet(NABDKey("MV"),DemoBrokerMinimumLotEnabled()?1.0:0.0);
   GlobalVariableSet(NABDKey("ND"),DemoWebsiteNoDailyLimitsEnabled()?1.0:0.0);
   GlobalVariableSet(NABDKey("VL"),InpNABDWebsiteRecommendations && InpNABDDemoRecommendations ? 1.0 : 0.0);
   GlobalVariableSet(NABDKey("RD"),MathMax(0.0,AccountInfoDouble(ACCOUNT_EQUITY)*InpMaxDailyLossPercent/100.0+GetTodayNet()));
   GlobalVariableSet(NABDKey("NF"),InpUseNewsFilter?1.0:0.0);
   GlobalVariableSet(NABDKey("PS"),NABDRemotePaused()?1.0:0.0);
   GlobalVariableSet(NABDKey("EM"),IsEmergencyStopActive()?1.0:0.0);
   GlobalVariableSet(NABDKey("EF"),(double)InpFastEmaPeriod);
   GlobalVariableSet(NABDKey("ES"),(double)InpSlowEmaPeriod);
   GlobalVariableSet(NABDKey("BT"),(double)PeriodSeconds(InpBiasTimeframe));
   GlobalVariableSet(NABDKey("ET"),(double)PeriodSeconds(InpEntryTimeframe));
   GlobalVariableSet(NABDKey("MS"),(double)InpMaxSpreadPoints);
   GlobalVariableSet(NABDKey("RR"),InpRewardRisk);
   GlobalVariableSet(NABDKey("NP"),(double)InpNewsMinutesBefore);
   GlobalVariableSet(NABDKey("NA"),(double)InpNewsMinutesAfter);
   GlobalVariableSet(NABDKey("DM"),InpNABDDemoRecommendations?1.0:0.0);
   GlobalVariableSet(NABDKey("WM"),InpNABDWebsiteRecommendations?1.0:0.0);
   GlobalVariableSet(NABDKey("WT"),(double)g_website_enabled_at);
   GlobalVariableSet(NABDKey("HB"),(double)TimeGMT());
   NABDProcessWebsiteApproval();
   NABDProcessDemoApproval();
  }
void NABDOnDeinit()
  {
   if(!InpEnableNABDLink || MQLInfoInteger(MQL_TESTER))return;
   GlobalVariableSet(NABDKey("HB"),0.0);GlobalVariableSet(NABDKey("L"),0.0);
  }

// Dashboard adapter. Demo recommendation approvals are executed only by the opted-in main EA.
// Network access is opt-in. All account details remain behind the operator login.
bool g_nb_warned=false;
int g_nb_last_http=0;
string g_nb_last_rejection="";
int g_nb_last_network_error=0;
bool g_nb_bootstrap_done=false;
bool g_nb_timer_seen=false;
string g_nb_local_warning="";
ulong g_nb_last_send=0;
datetime g_nb_calendar_time=0;
datetime g_nb_daily_time=0;
string g_nb_daily="[]";
string g_nb_calendar="{\"status\":\"unavailable\",\"events\":[]}";
string NBQ(const string s)
  {
   string result="\"";
   for(int i=0;i<StringLen(s);i++)
     {
      ushort c=StringGetCharacter(s,i);
      if(c==34) result+="\\\"";
      else if(c==92) result+="\\\\";
      else if(c<32) result+=StringFormat("\\u%04x",(uint)c);
      else result+=ShortToString(c);
     }
   return result+"\"";
  }
string NBD(const double value,const int digits=8)
  { return MathIsValidNumber(value) ? DoubleToString(value,digits) : "null"; }
string NBB(const bool value) { return value ? "true" : "false"; }
long NBOffset()
  {
   if(InpNABDServerUtcOffsetMinutes!=2147483647) return (long)InpNABDServerUtcOffsetMinutes*60;
   return (long)MathRound((double)(TimeTradeServer()-TimeGMT())/900.0)*900;
  }
string NBEA(const long offset)
  {
   bool fresh=NBMainFresh();
   double stamp=NBMainValue("ST"),side=NBMainValue("SD");
   string signal="null";
   if(fresh && stamp>0 && (side==1 || side==-1))
     {
      string candidate="{\"side\":"+NBQ(side==1?"BUY":"SELL")+",\"issued_at\":"+NBD(stamp,0)+
       ",\"bar_time\":"+NBD(NBMainValue("SB")-(double)offset,0)+",\"entry\":"+NBD(NBMainValue("SE"),g_digits)+
       ",\"sl\":"+NBD(NBMainValue("SSL"),g_digits)+",\"target\":"+NBD(NBMainValue("STP"),g_digits)+
       ",\"rsi\":"+NBD(NBMainValue("SR"))+",\"atr\":"+NBD(NBMainValue("SA"))+"}";
      if(stamp==NBMainValue("ST"))signal=candidate;
     }
   return "{\"heartbeat_at\":"+NBD(NBMainValue("HB"),0)+",\"checked_at\":"+NBD(NBMainValue("CHK"),0)+
    ",\"emergency_stop\":"+NBB(NBMainValue("EM")>0.5)+",\"settings\":{\"ema_fast\":"+NBD(NBMainValue("EF"),0)+
    ",\"ema_slow\":"+NBD(NBMainValue("ES"),0)+",\"bias_seconds\":"+NBD(NBMainValue("BT"),0)+
    ",\"entry_seconds\":"+NBD(NBMainValue("ET"),0)+",\"max_spread_points\":"+NBD(NBMainValue("MS"),0)+
    ",\"reward_risk\":"+NBD(NBMainValue("RR"))+",\"news_before_minutes\":"+NBD(NBMainValue("NP"),0)+
    ",\"news_after_minutes\":"+NBD(NBMainValue("NA"),0)+"},\"signal\":"+signal+"}";
  }
string NBUrl(const string path)
  {
   string base=InpNABDUrl;
   while(StringLen(base)>0 && StringSubstr(base,StringLen(base)-1)=="/") base=StringSubstr(base,0,StringLen(base)-1);
   return base+path;
  }
int NBRequest(const string method,const string path,const string payload,string &response)
  {
   char data[],result[];
   if(StringLen(payload)>0) {StringToCharArray(payload,data,0,WHOLE_ARRAY,CP_UTF8);ArrayResize(data,ArraySize(data)-1);}
   string headers="Authorization: Bearer "+InpNABDToken+"\r\nContent-Type: application/json\r\n";
   string result_headers;
   ResetLastError();
   int code=WebRequest(method,NBUrl(path),headers,InpNABDRequestTimeoutMs,data,result,result_headers);
   g_nb_last_network_error=code==-1?GetLastError():0;
   GlobalVariableSet(NABDKey("HB"),(double)TimeGMT());
   response=CharArrayToString(result,0,WHOLE_ARRAY,CP_UTF8);
   if(code==-1 && g_nb_last_http!=-1)
      PrintFormat("NABD link failed. Error=%d. Check allowed WebRequest URLs and the internet connection.",g_nb_last_network_error);
   return code;
  }
string NBCandles(const ENUM_TIMEFRAMES tf,const long offset,const int count=320)
  {
   MqlRates bars[];ArraySetAsSeries(bars,false);
   int n=CopyRates(g_symbol,tf,1,count,bars);
   string json="[";
   for(int i=0;i<n;i++)
     {
      if(i>0)json+=",";
      json+="{\"time\":"+(string)((long)bars[i].time-offset)+",\"open\":"+NBD(bars[i].open,g_digits)+
            ",\"high\":"+NBD(bars[i].high,g_digits)+",\"low\":"+NBD(bars[i].low,g_digits)+
            ",\"close\":"+NBD(bars[i].close,g_digits)+",\"tick_volume\":"+(string)bars[i].tick_volume+"}";
     }
   return json+"]";
  }
string NBUnit(const MqlCalendarEvent &event)
  {
   string unit="";
   if(event.unit==CALENDAR_UNIT_PERCENT)unit="%";
   else if(event.unit==CALENDAR_UNIT_USD || event.unit==CALENDAR_UNIT_CURRENCY)unit="USD";
   else if(event.unit==CALENDAR_UNIT_JOB)unit="وظيفة";
   else if(event.unit==CALENDAR_UNIT_PEOPLE)unit="شخص";
   else if(event.unit==CALENDAR_UNIT_HOUR)unit="ساعة";
   if(event.multiplier==CALENDAR_MULTIPLIER_THOUSANDS)unit="ألف "+unit;
   else if(event.multiplier==CALENDAR_MULTIPLIER_MILLIONS)unit="مليون "+unit;
   else if(event.multiplier==CALENDAR_MULTIPLIER_BILLIONS)unit="مليار "+unit;
   else if(event.multiplier==CALENDAR_MULTIPLIER_TRILLIONS)unit="تريليون "+unit;
   return unit;
  }
void NBUpdateCalendar(const long offset)
  {
   datetime now=TimeGMT();
   if(now-g_nb_calendar_time<60 && g_nb_calendar_time>0)return;
   g_nb_calendar_time=now;
   MqlCalendarValue values[];
   datetime server=TimeTradeServer();
   int n=CalendarValueHistory(values,server-6*3600,server+24*3600,NULL,"USD");
   // Casting datetime directly to string formats a date, which is not a JSON number.
   if(n<0){g_nb_calendar="{\"status\":\"unavailable\",\"updated_at\":"+(string)((long)now)+",\"events\":[]}";return;}
   string json="[";int count=0;bool complete=true;
   for(int i=0;i<n && count<200;i++)
     {
      MqlCalendarEvent event;
      if(!CalendarEventById(values[i].event_id,event)){complete=false;continue;}
      if(event.time_mode!=CALENDAR_TIMEMODE_DATETIME)
        {if(event.importance==CALENDAR_IMPORTANCE_HIGH)complete=false;continue;}
      if(count++>0)json+=",";
      json+="{\"id\":"+NBQ((string)values[i].id)+",\"name\":"+NBQ(event.name)+
            ",\"currency\":\"USD\",\"time\":"+(string)((long)values[i].time-offset)+
            ",\"importance\":"+(string)(int)event.importance+
            ",\"actual\":"+(values[i].HasActualValue()?NBD(values[i].GetActualValue()):"null")+
            ",\"forecast\":"+(values[i].HasForecastValue()?NBD(values[i].GetForecastValue()):"null")+
            ",\"previous\":"+(values[i].HasRevisedValue()?NBD(values[i].GetRevisedValue()):values[i].HasPreviousValue()?NBD(values[i].GetPreviousValue()):"null")+
            ",\"unit\":"+NBQ(NBUnit(event))+"}";
     }
   if(n>200)complete=false;
   g_nb_calendar="{\"status\":"+NBQ(complete?"ok":"unavailable")+",\"updated_at\":"+(string)((long)now)+",\"events\":"+json+"]}";
  }
string NBPositions(const long offset)
  {
   string json="[";int n=0;
   for(int i=0;i<PositionsTotal();i++)
     {
      ulong ticket=PositionGetTicket(i);
      if(!ticket || !IsOwnPositionSelected())continue;
      if(n++>0)json+=",";
      json+="{\"ticket\":"+NBQ((string)ticket)+",\"side\":"+NBQ(PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?"BUY":"SELL")+
            ",\"volume\":"+NBD(PositionGetDouble(POSITION_VOLUME))+
            ",\"entry\":"+NBD(PositionGetDouble(POSITION_PRICE_OPEN),g_digits)+
            ",\"sl\":"+NBD(PositionGetDouble(POSITION_SL),g_digits)+",\"tp\":"+NBD(PositionGetDouble(POSITION_TP),g_digits)+
            ",\"profit\":"+NBD(PositionGetDouble(POSITION_PROFIT),2)+",\"swap\":"+NBD(PositionGetDouble(POSITION_SWAP),2)+
            ",\"opened_at\":"+(string)((long)PositionGetInteger(POSITION_TIME)-offset)+"}";
     }
   return json+"]";
  }
string NBDeals(const long offset)
  {
   string json="[";int n=0;
   if(!HistorySelect(ServerNow()-30*86400,ServerNow()))return "[]";
   for(int i=(int)MathMax(0,HistoryDealsTotal()-1000);i<HistoryDealsTotal();i++)
     {
      ulong ticket=HistoryDealGetTicket(i);
      if(!ticket || HistoryDealGetString(ticket,DEAL_SYMBOL)!=g_symbol || (long)HistoryDealGetInteger(ticket,DEAL_MAGIC)!=InpMagicNumber)continue;
      ENUM_DEAL_TYPE kind=(ENUM_DEAL_TYPE)HistoryDealGetInteger(ticket,DEAL_TYPE);
      if(kind!=DEAL_TYPE_BUY && kind!=DEAL_TYPE_SELL)continue;
      ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket,DEAL_ENTRY);
      string entry_name=entry==DEAL_ENTRY_IN?"IN":entry==DEAL_ENTRY_OUT?"OUT":entry==DEAL_ENTRY_INOUT?"INOUT":"OUT_BY";
      if(n++>0)json+=",";
      json+="{\"ticket\":"+NBQ((string)ticket)+",\"position_id\":"+NBQ((string)HistoryDealGetInteger(ticket,DEAL_POSITION_ID))+
            ",\"time\":"+(string)((long)HistoryDealGetInteger(ticket,DEAL_TIME)-offset)+",\"side\":"+NBQ(kind==DEAL_TYPE_BUY?"BUY":"SELL")+
            ",\"entry_type\":"+NBQ(entry_name)+",\"volume\":"+NBD(HistoryDealGetDouble(ticket,DEAL_VOLUME))+
            ",\"price\":"+NBD(HistoryDealGetDouble(ticket,DEAL_PRICE),g_digits)+
            ",\"profit\":"+NBD(HistoryDealGetDouble(ticket,DEAL_PROFIT),2)+
            ",\"commission\":"+NBD(HistoryDealGetDouble(ticket,DEAL_COMMISSION),2)+
            ",\"swap\":"+NBD(HistoryDealGetDouble(ticket,DEAL_SWAP),2)+",\"fee\":"+NBD(HistoryDealGetDouble(ticket,DEAL_FEE),2)+"}";
     }
   return json+"]";
  }
// Bind every control poll and result to this account, broker, symbol and Magic.
string NBControlIdentity()
  {
   return "\"account_ref\":"+NBQ((string)AccountInfoInteger(ACCOUNT_LOGIN))+
      ",\"broker\":"+NBQ(AccountInfoString(ACCOUNT_SERVER))+",\"symbol\":"+NBQ(g_symbol)+
      ",\"magic\":"+NBQ((string)InpMagicNumber);
  }
void NBAcknowledge(const long id,const string status,const string message)
  {
   string response;
   NBRequest("POST","/api/bridge/result","{"+NBControlIdentity()+",\"id\":"+(string)id+",\"status\":"+NBQ(status)+",\"message\":"+NBQ(message)+"}",response);
  }
void NBProcessDemoRecommendation()
  {
   if(NBMainValue("WM")>0.5)return;
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO || !NBMainFresh() ||
      NBMainValue("DM")<0.5 || !InpNABDAllowRemoteControl || !InpNABDSendAccount || NABDRemotePaused())return;
   string response,payload="{\"account_ref\":"+NBQ((string)AccountInfoInteger(ACCOUNT_LOGIN))+
     ",\"broker\":"+NBQ(AccountInfoString(ACCOUNT_SERVER))+",\"symbol\":"+NBQ(g_symbol)+",\"magic\":"+NBQ((string)InpMagicNumber)+"}";
   if(NBRequest("POST","/api/bridge/demo-recommendation",payload,response)!=200 || StringLen(response)==0)return;
   string parts[];if(StringSplit(response,'|',parts)!=11 || parts[0]!="NBDEMO1" ||
      parts[1]!=(string)AccountInfoInteger(ACCOUNT_LOGIN) || parts[2]!=g_symbol || parts[3]!=(string)InpMagicNumber)return;
   int direction=parts[4]=="BUY"?1:parts[4]=="SELL"?-1:0;
   double entry=StringToDouble(parts[5]),sl=StringToDouble(parts[6]),tp=StringToDouble(parts[7]);
   long issued=StringToInteger(parts[8]),expiry=StringToInteger(parts[9]),bar=StringToInteger(parts[10])+NBOffset();
   if(!direction || !MathIsValidNumber(entry) || !MathIsValidNumber(sl) || !MathIsValidNumber(tp) ||
      entry<=0 || sl<=0 || tp<=0 || issued<=0 || issued>(long)TimeGMT()+5 || (long)TimeGMT()-issued>75 ||
      expiry<(long)TimeGMT() || expiry>(long)TimeGMT()+20 || (double)issued!=NBMainValue("ST") ||
      (double)bar!=NBMainValue("SB") || (double)issued<=NBMainValue("DC"))return;
   GlobalVariableSet(NABDKey("DA"),0.0);
   GlobalVariableSet(NABDKey("DD"),(double)direction);GlobalVariableSet(NABDKey("DB"),(double)bar);
   GlobalVariableSet(NABDKey("DE"),entry);GlobalVariableSet(NABDKey("DSL"),sl);GlobalVariableSet(NABDKey("DTP"),tp);
   GlobalVariableSet(NABDKey("DX"),(double)expiry);
   GlobalVariableSet(NABDKey("DA"),(double)issued);
  }
void NBProcessWebsiteRecommendation()
  {
   static double reported_id=0;
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO || !NBMainFresh() ||
      NBMainValue("WM")<0.5 || NBMainValue("DM")<0.5 || !InpNABDAllowRemoteControl || !InpNABDSendAccount)return;
   string source="\"account_ref\":"+NBQ((string)AccountInfoInteger(ACCOUNT_LOGIN))+
     ",\"broker\":"+NBQ(AccountInfoString(ACCOUNT_SERVER))+",\"symbol\":"+NBQ(g_symbol)+",\"magic\":"+NBQ((string)InpMagicNumber);
   double result_id=NBMainValue("WI"),result=NBMainValue("WR");string response;
   if(result_id>reported_id && result_id==NBMainValue("WI") && (result==1 || result==2))
      if(NBRequest("POST","/api/bridge/website-result","{"+source+",\"id\":"+NBD(result_id,0)+
       ",\"status\":"+NBQ(result==2?"SUBMITTED":"REJECTED")+
       ",\"reason_code\":"+NBD(NBMainValue("WRC"),0)+
       ",\"mt5_retcode\":"+NBD(NBMainValue("WRT"),0)+
       ",\"deal_ticket\":"+NBQ(NBD(NBMainValue("WDT"),0))+"}",response)==200)reported_id=result_id;
   // A local terminal with Algo Trading off must never claim a recommendation
   // that belongs to an executable copy on the MetaTrader VPS.
   if(!TradingExecutionEnabled())return;
   if(NABDRemotePaused())return;
   if(NBRequest("POST","/api/bridge/website-recommendation","{"+source+"}",response)!=200 || StringLen(response)==0)return;
   string parts[];int fields=StringSplit(response,'|',parts);
   if((fields!=12 && fields!=13) || parts[0]!="NBWEB1" ||
      parts[1]!=(string)AccountInfoInteger(ACCOUNT_LOGIN) || parts[2]!=g_symbol || parts[3]!=(string)InpMagicNumber)return;
   int direction=parts[4]=="BUY"?1:parts[4]=="SELL"?-1:0;
   double entry=StringToDouble(parts[5]),sl=StringToDouble(parts[6]),tp=StringToDouble(parts[7]);
   long issued=StringToInteger(parts[8]),expiry=StringToInteger(parts[9]),bar=StringToInteger(parts[10])+NBOffset(),id=StringToInteger(parts[11]);
   if(!direction || id<=0 || id>9007199254740991 || (double)id<=NBMainValue("WC") ||
      issued<=0 || issued>(long)TimeGMT()+5 || (long)TimeGMT()-issued>75 || expiry<=(long)TimeGMT() ||
      expiry>(long)TimeGMT()+20 || (double)issued<NBMainValue("WT") ||
      !MathIsValidNumber(entry) || !MathIsValidNumber(sl) || !MathIsValidNumber(tp) || entry<=0 || sl<=0 || tp<=0)return;
   GlobalVariableSet(NABDKey("WA"),0.0);
   GlobalVariableSet(NABDKey("WD"),(double)direction);GlobalVariableSet(NABDKey("WB"),(double)bar);
   GlobalVariableSet(NABDKey("WE"),entry);GlobalVariableSet(NABDKey("WL"),sl);GlobalVariableSet(NABDKey("WP"),tp);
   GlobalVariableSet(NABDKey("WF"),(double)issued);GlobalVariableSet(NABDKey("WX"),(double)expiry);
   // AUTO approvals have 12 fields. Reading parts[12] in that case is a
   // fatal MQL array-out-of-range error and stops this bridge's timer.
   // Always reset the previous manual lot when the next approval is AUTO.
   GlobalVariableSet(NABDKey("WV"),fields==13?StringToDouble(parts[12]):0.0);
   GlobalVariableSet(NABDKey("WA"),(double)id);
  }
void NBProcessCommand()
  {
   string response;
   if(NBRequest("POST","/api/bridge/control-next","{"+NBControlIdentity()+"}",response)!=200)return;
   // Old unscoped commands remain gold-only during the upgrade.
   string instrument=g_symbol;StringToUpper(instrument);
   if(StringLen(response)==0 && StringFind(instrument,"BTCUSD")!=0)
      if(NBRequest("GET","/api/bridge/next","",response)!=200)return;
   if(StringLen(response)==0)return;
   string parts[];if(StringSplit(response,'|',parts)!=6)return;
   long id=StringToInteger(parts[0]);string action=parts[1];ulong ticket=(ulong)StringToInteger(parts[2]);
   double fraction=StringToDouble(parts[3]);long created=StringToInteger(parts[4]),expiry=StringToInteger(parts[5]);
   if(id<=0 || created>(long)TimeGMT()+5 || expiry<(long)TimeGMT()) {NBAcknowledge(id,"REJECTED","Expired or invalid command");return;}
   if(!InpNABDAllowRemoteControl || !InpNABDSendAccount || !NBMainFresh() || NBMainValue("R")<0.5){NBAcknowledge(id,"REJECTED","Remote control not allowed by the main EA and bridge");return;}
   if(GlobalVariableCheck(NABDKey("C")) && GlobalVariableGet(NABDKey("C"))>=(double)id)
     {NBAcknowledge(id,"UNCERTAIN","Command already claimed; it will not execute a second time");return;}
   // Persist the claim BEFORE submitting an order; a lost acknowledgement cannot replay a partial close.
   GlobalVariableSet(NABDKey("C"),(double)id);GlobalVariablesFlush();
   if(action=="PAUSE" || action=="RESUME")
     {GlobalVariableSet(NABDKey("P"),action=="PAUSE"?1.0:0.0);GlobalVariablesFlush();NBAcknowledge(id,"CONFIRMED",action);return;}
   if(!TradingExecutionEnabled() || !ExecutionPermissionsAvailable())
     {NBAcknowledge(id,"REJECTED","Execution disabled or trading permissions unavailable");return;}
   if(action=="CLOSE_ALL")
     {
      bool confirmed=true;
      for(int i=PositionsTotal()-1;i>=0;i--)
        {
         ulong t=PositionGetTicket(i);
         if(!t || !IsOwnPositionSelected())continue;
         if(!g_trade.PositionClose(t,InpDeviationPoints) || !IsSuccessfulRetcode(g_trade.ResultRetcode()))confirmed=false;
        }
      confirmed=confirmed && CountOwnPositions()==0;
      NBAcknowledge(id,confirmed?"CONFIRMED":"UNCERTAIN",confirmed?"All managed positions closed":"Some positions may remain; inspect MT5");return;
     }
   if(!PositionSelectByTicket(ticket) || !IsOwnPositionSelected())
     {NBAcknowledge(id,"REJECTED","Position is not owned by this EA");return;}
   double before=PositionGetDouble(POSITION_VOLUME);
   bool sent=false,confirmed=false;
   if(action=="CLOSE_POSITION")
     {sent=g_trade.PositionClose(ticket,InpDeviationPoints);confirmed=sent && IsSuccessfulRetcode(g_trade.ResultRetcode()) && !PositionSelectByTicket(ticket);}
   else if(action=="PARTIAL_CLOSE")
     {
      if(!IsHedgingAccount() || !(fraction>0 && fraction<1))
        {NBAcknowledge(id,"REJECTED","Partial close requires a hedging account and valid fraction");return;}
      double step=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP),minimum=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN);
      double amount=MathFloor(before*fraction/step+1.0e-8)*step;
      if(amount<minimum || before-amount<minimum-1.0e-8)
        {NBAcknowledge(id,"REJECTED","Volume does not support a partial close");return;}
      sent=g_trade.PositionClosePartial(ticket,amount,InpDeviationPoints);
      confirmed=sent && IsSuccessfulRetcode(g_trade.ResultRetcode()) && PositionSelectByTicket(ticket) && PositionGetDouble(POSITION_VOLUME)<before;
     }
   else if(action=="BREAK_EVEN")
     {
      bool buy=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY;
      double entry=NormalizePrice(PositionGetDouble(POSITION_PRICE_OPEN)),old=PositionGetDouble(POSITION_SL),tp=PositionGetDouble(POSITION_TP);
      MqlTick tick; if(!SymbolInfoTick(g_symbol,tick)){NBAcknowledge(id,"REJECTED","No fresh quote");return;}
      double distance=MinimumStopDistance();
      if((buy && (tick.bid-entry<distance || (old>0 && entry<old))) || (!buy && (entry-tick.ask<distance || (old>0 && entry>old))))
        {NBAcknowledge(id,"REJECTED","Break-even would worsen the stop or violates broker distance");return;}
      sent=g_trade.PositionModify(ticket,entry,tp);
      confirmed=sent && IsSuccessfulRetcode(g_trade.ResultRetcode()) && PositionSelectByTicket(ticket) && MathAbs(PositionGetDouble(POSITION_SL)-entry)<g_point;
     }
   else {NBAcknowledge(id,"REJECTED","Unknown command");return;}
   NBAcknowledge(id,confirmed?"CONFIRMED":sent?"UNCERTAIN":"REJECTED",g_trade.ResultRetcodeDescription());
  }
// Best-effort BTC-only quote preflight; the server never treats this as an EA heartbeat.
bool NBSendBtcFastQuote(const MqlTick &tick,const long offset)
  {
   if((long)tick.time-offset>(long)TimeGMT()+5)
     {NBStatus("BTC broker tick time ahead of UTC; waiting.");return false;}
   string quick="{\"symbol\":"+NBQ(g_symbol)+
     ",\"account_ref\":"+NBQ((string)AccountInfoInteger(ACCOUNT_LOGIN))+
     ",\"broker\":"+NBQ(AccountInfoString(ACCOUNT_SERVER))+
     ",\"magic\":"+NBQ((string)InpMagicNumber)+
     ",\"quote_at\":"+(string)((long)tick.time-offset)+
     ",\"bid\":"+NBD(tick.bid,g_digits)+",\"ask\":"+NBD(tick.ask,g_digits)+"}";
   string reply;
   int code=NBRequest("POST","/api/mt5/btc-quote",quick,reply);
   if(code!=200)
     {NBStatus("BTC fast quote declined (HTTP "+(string)code+"); full MT5 sync continues.");return false;}
   return true;
  }
void NBBOnTimer()
  {
   if(!InpEnableNABDLink){NBStatus("Link disabled: set InpEnableNABDLink=true.");return;}
   if(MQLInfoInteger(MQL_TESTER))return;
   // An inactive local bridge would overwrite the live VPS execution state and
   // could race the VPS for an identical website recommendation. Only the
   // terminal permitted to execute may publish in website trading mode.
   if(NBMainFresh() && NBMainValue("WM")>0.5 && InpNABDAllowRemoteControl && InpNABDSendAccount && !TradingExecutionEnabled())
     {
      static bool duplicate_warned=false;
      if(!duplicate_warned)Print("NABD non-executing bridge suspended; verify that the MetaTrader VPS has the only active execution bridge.");
      duplicate_warned=true;
      NBStatus("Execution not permitted here. No telemetry or approval will be sent.");
      return;
     }
   if(StringLen(InpNABDToken)<32 || StringFind(InpNABDUrl,"https://")!=0)
     {if(!g_nb_warned){Print("NABD requires an HTTPS URL and a 32+ character ingest token.");g_nb_warned=true;}return;}
   ulong now=GetTickCount64();
   // A BTC terminal uses a one-second best-effort cadence. Gold is unchanged.
   // Broker quotes keep their original SymbolInfoTick timestamp.
   bool btcOneSecond=StringFind(g_symbol,"BTCUSD")==0;
   ulong cadenceMs=(ulong)(btcOneSecond?1000:MathMax(3,InpNABDRefreshSeconds)*1000);
   if(g_nb_last_send>0 && now-g_nb_last_send<cadenceMs)return;
   g_nb_last_send=now;
   if(!g_nb_timer_seen)
     {Print("NABD timer running. Sending the first quote before loading history and the calendar.");g_nb_timer_seen=true;}
   MqlTick tick;
   if(!SymbolInfoTick(g_symbol,tick) || tick.bid<=0 || tick.ask<tick.bid)
     {NBStatus("Waiting for a valid broker quote. Check the symbol and broker connection.");return;}
   long offset=NBOffset();
   // Only BTC sends a lightweight authenticated tick between normal FULL
   // snapshots (3 seconds). No account/EA permissions or bars are fabricated.
   static ulong lastBtcFullSend=0;
   static datetime lastBtcFullClosedBar=0;
   if(btcOneSecond && g_nb_bootstrap_done && lastBtcFullSend>0 &&
      now-lastBtcFullSend<3000 && iTime(g_symbol,PERIOD_M5,1)==lastBtcFullClosedBar)
     {
      if(NBSendBtcFastQuote(tick,offset) && InpNABDAllowRemoteControl && InpNABDSendAccount)
        {
         // Consume the freshly generated website plan on this one-second tick,
         // instead of waiting for the next three-second account snapshot.
         NBProcessWebsiteRecommendation();
        }
      return;
     }
   if(btcOneSecond)lastBtcFullSend=now;
   // Preflight a genuine tick before synchronous calendar, OHLC and daily data loading.
   // Does not authorize execution or extend EA heartbeat; stale full snapshots still block.
   if(btcOneSecond && g_nb_bootstrap_done) NBSendBtcFastQuote(tick,offset);
   // Let the real price reach the dashboard before potentially slow MT5 history/calendar calls.
   // Empty history and an unavailable calendar are explicit; they are never fabricated.
   string candles="{\"M5\":[],\"M15\":[],\"H1\":[],\"H4\":[]}";
   string calendar="{\"status\":\"unavailable\",\"events\":[]}";
   // BTC reuses the last CLOSED candle set between refreshes, avoiding
   // four expensive CopyRates calls each second. Never synthesize OHLC.
   static string cachedBtcCandles="";
   static ulong lastBtcHistory=0;
   static datetime cachedBtcClosedBar=0;
   datetime latestClosedBar=iTime(g_symbol,PERIOD_M5,1);
   bool refreshBtcHistory=!btcOneSecond || cachedBtcCandles=="" ||
      latestClosedBar!=cachedBtcClosedBar || now-lastBtcHistory>=5000;
   if(g_nb_bootstrap_done)
     {
      if(!refreshBtcHistory)
        {
         candles=cachedBtcCandles;
         calendar=g_nb_calendar;
        }
      else
        {
      NBStatus("Loading economic calendar from MT5...");NBUpdateCalendar(offset);
      NBStatus("Loading M5, M15, H1 and H4 history from MT5...");
      candles="{\"M5\":"+NBCandles(PERIOD_M5,offset)+",\"M15\":"+NBCandles(PERIOD_M15,offset)+
        ",\"H1\":"+NBCandles(PERIOD_H1,offset)+",\"H4\":"+NBCandles(PERIOD_H4,offset)+"}";
      calendar=g_nb_calendar;
      if(btcOneSecond){cachedBtcCandles=candles;lastBtcHistory=GetTickCount64();cachedBtcClosedBar=latestClosedBar;}
        }
      if(g_nb_daily_time==0 || TimeGMT()-g_nb_daily_time>=3600)
        {
         NBStatus("Loading closed daily history for internal analysis...");
         g_nb_daily=NBCandles(PERIOD_D1,offset,1200);
         g_nb_daily_time=g_nb_daily=="[]"?TimeGMT()-3540:TimeGMT();
        }
     }
   // History/calendar may take time; send the latest broker tick available after they finish.
   if(!SymbolInfoTick(g_symbol,tick) || tick.bid<=0 || tick.ask<tick.bid)
     {NBStatus("Waiting for a valid broker quote.");return;}
   if((long)tick.time-offset>(long)TimeGMT()+5)
     {
      string warning="Broker quote is ahead of UTC. Check the computer clock and set InpNABDServerUtcOffsetMinutes=2147483647 for automatic detection.";
      NBStatus(warning);
      if(g_nb_local_warning!=warning){Print("NABD: "+warning);g_nb_local_warning=warning;}
      return;
     }
   g_nb_local_warning="";
   double buy_margin=0,sell_margin=0;
   bool bm=OrderCalcMargin(ORDER_TYPE_BUY,g_symbol,1.0,tick.ask,buy_margin),sm=OrderCalcMargin(ORDER_TYPE_SELL,g_symbol,1.0,tick.bid,sell_margin);
   double margin=bm && sm?MathMax(buy_margin,sell_margin):0;
   string spec="{\"digits\":"+(string)g_digits+",\"point\":"+NBD(g_point)+
     ",\"tick_size\":"+NBD(SymbolInfoDouble(g_symbol,SYMBOL_TRADE_TICK_SIZE))+
     ",\"tick_value_loss\":"+NBD(SymbolInfoDouble(g_symbol,SYMBOL_TRADE_TICK_VALUE_LOSS))+
     ",\"tick_value_profit\":"+NBD(SymbolInfoDouble(g_symbol,SYMBOL_TRADE_TICK_VALUE_PROFIT))+
     ",\"volume_min\":"+NBD(SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN))+
     ",\"volume_max\":"+NBD(SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MAX))+
     ",\"volume_step\":"+NBD(SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP))+
     ",\"stops_points\":"+(string)SymbolInfoInteger(g_symbol,SYMBOL_TRADE_STOPS_LEVEL)+
     ",\"margin_per_lot\":"+NBD(margin)+",\"currency\":"+NBQ(AccountInfoString(ACCOUNT_CURRENCY))+"}";
   string payload="{\"symbol\":"+NBQ(g_symbol)+",\"account_ref\":"+NBQ((string)AccountInfoInteger(ACCOUNT_LOGIN))+
     ",\"broker\":"+NBQ(AccountInfoString(ACCOUNT_SERVER))+",\"terminal_connected\":"+NBB((bool)TerminalInfoInteger(TERMINAL_CONNECTED))+
     ",\"quote_at\":"+(string)((long)tick.time-offset)+",\"bid\":"+NBD(tick.bid,g_digits)+",\"ask\":"+NBD(tick.ask,g_digits)+
     ",\"spec\":"+spec+",\"candles\":"+candles+",\"calendar\":"+calendar+
     ",\"execution\":{\"main_connected\":"+NBB(NBMainFresh())+",\"enabled\":"+NBB(TradingExecutionEnabled())+",\"remote_control\":"+NBB(InpNABDAllowRemoteControl && InpNABDSendAccount && NBMainFresh() && NBMainValue("R")>0.5)+
     ",\"demo_recommendations\":"+NBB(NBMainFresh() && NBMainValue("DM")>0.5)+
     ",\"website_recommendations\":"+NBB(NBMainFresh() && NBMainValue("WM")>0.5)+
     ",\"website_since\":"+NBD(NBMainValue("WT"),0)+
     ",\"demo_result\":"+NBQ(NBMainValue("DR")==2?"SUBMITTED":NBMainValue("DR")==3?"BLOCKED":"WAITING")+
     ",\"demo\":"+NBB(AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO)+",\"paused\":"+NBB(NABDRemotePaused())+
     ",\"managed_magic\":"+NBQ((string)InpMagicNumber)+",\"small_profit_target\":"+NBD(NBMainValue("TP"),2)+
     ",\"max_daily_loss_percent\":"+NBD(NBMainValue("DL"),2)+",\"risk_percent\":"+NBD(NBMainValue("RP"),2)+
     ",\"minimum_volume_fallback\":"+NBB(NBMainFresh() && NBMainValue("MV")>0.5)+
     ",\"website_no_daily_limits\":"+NBB(NBMainFresh() && NBMainValue("ND")>0.5)+
     ",\"manual_lot_supported\":"+NBB(NBMainFresh() && NBMainValue("VL")>0.5)+
     ",\"control_protocol\":2"+
     ",\"daily_risk_remaining\":"+NBD(NBMainValue("RD"))+
     ",\"news_filter\":"+NBB(NBMainValue("NF")>0.5)+"},\"ea\":"+NBEA(offset);
   if(g_nb_bootstrap_done)payload+=",\"daily_candles\":"+g_nb_daily;
   if(InpNABDSendAccount)
      payload+=",\"account\":{\"currency\":"+NBQ(AccountInfoString(ACCOUNT_CURRENCY))+
        ",\"balance\":"+NBD(AccountInfoDouble(ACCOUNT_BALANCE),2)+",\"equity\":"+NBD(AccountInfoDouble(ACCOUNT_EQUITY),2)+
        ",\"free_margin\":"+NBD(AccountInfoDouble(ACCOUNT_MARGIN_FREE),2)+",\"floating\":"+NBD(AccountInfoDouble(ACCOUNT_PROFIT),2)+
        "},\"positions\":"+NBPositions(offset)+",\"deals\":"+NBDeals(offset);
   payload+="}";
   NBStatus("Sending update to the dashboard...");
   string response;int code=NBRequest("POST","/api/mt5",payload,response);
   if(code!=200)
     {
      string detail=StringSubstr(response,0,300);
      StringReplace(detail,"\r"," ");StringReplace(detail,"\n"," ");
      if(code!=g_nb_last_http || detail!=g_nb_last_rejection)
         PrintFormat("NABD update rejected. HTTP=%d. Server: %s",code,detail);
      if(code==-1)
         NBStatus("WebRequest error "+(string)g_nb_last_network_error+". Check allowed URLs and the internet connection.");
      else if(code==401)
         NBStatus("HTTP 401: use the server MT5_INGEST_TOKEN, not the operator login token.");
      else
         NBStatus("HTTP "+(string)code+": "+detail);
      g_nb_last_http=code;g_nb_last_rejection=detail;
      return;
     }
   if(g_nb_last_http!=200)Print("NABD telemetry accepted by dashboard.");
   g_nb_last_http=200;g_nb_last_rejection="";
   if(btcOneSecond)lastBtcFullClosedBar=iTime(g_symbol,PERIOD_M5,1);
   bool first=!g_nb_bootstrap_done;g_nb_bootstrap_done=true;
   NBStatus(first?"First quote accepted. History/calendar will load on the next update.":
     NBMainFresh()?"Update accepted by dashboard. Main bot link present.":"Update accepted by dashboard. Waiting for the main bot link.");
   if(InpNABDAllowRemoteControl && InpNABDSendAccount)
     {
      NBProcessCommand();
      NBProcessWebsiteRecommendation();
      NBProcessDemoRecommendation();
     }
  }

// Publish -> network -> consume. A freshly received approval is consumed in this event.
void NABDOnTimer()
  {
   NBLOnTimer();
   NBBOnTimer();
   NBLOnTimer();
  }

