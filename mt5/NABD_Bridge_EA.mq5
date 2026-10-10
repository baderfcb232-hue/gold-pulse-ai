#property strict
#property version "3.00"
#property description "NABD MT5 telemetry bridge. Separate chart; it does not open trades."
#include <Trade/Trade.mqh>
CTrade g_trade;
input group "Source"
input string InpSymbol="";
input long InpMagicNumber=26092301;
input int InpDeviationPoints=30;
input group "Dashboard"
input bool InpEnableNABDLink=true;
input string InpNABDUrl="https://gold-pulse-ai.onrender.com";
input string InpNABDToken="";
input int InpNABDRefreshSeconds=3;
input bool InpNABDSendAccount=false;
input bool InpNABDAllowRemoteControl=false;
input int InpNABDServerUtcOffsetMinutes=2147483647;
string g_symbol="";
int g_digits=0;
double g_point=0;
string NABDKey(const string suffix);
void NABDOnTimer();
double NBMainValue(const string suffix)
  {return GlobalVariableCheck(NABDKey(suffix))?GlobalVariableGet(NABDKey(suffix)):0.0;}
bool NBMainFresh()
  {double t=NBMainValue("HB");return t>0 && (double)TimeGMT()-t>=-5 && (double)TimeGMT()-t<=5;}
bool ExecutionPermissionsAvailable()
  {return (bool)TerminalInfoInteger(TERMINAL_CONNECTED) && (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) &&
          (bool)MQLInfoInteger(MQL_TRADE_ALLOWED) && (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) &&
          (bool)AccountInfoInteger(ACCOUNT_TRADE_EXPERT);}
bool TradingExecutionEnabled()
  {return NBMainFresh() && NBMainValue("L")>0.5 && ExecutionPermissionsAvailable();}
bool IsHedgingAccount()
  {return AccountInfoInteger(ACCOUNT_MARGIN_MODE)==ACCOUNT_MARGIN_MODE_RETAIL_HEDGING;}
bool IsOwnPositionSelected()
  {
   if(PositionGetString(POSITION_SYMBOL)!=g_symbol || (long)PositionGetInteger(POSITION_MAGIC)!=InpMagicNumber)return false;
   if(IsHedgingAccount())return true;
   ulong id=(ulong)PositionGetInteger(POSITION_IDENTIFIER);
   if(!HistorySelectByPosition(id))return false;
   for(int i=0;i<HistoryDealsTotal();i++)
     {
      ulong d=HistoryDealGetTicket(i);long type=HistoryDealGetInteger(d,DEAL_TYPE);
      if((type==DEAL_TYPE_BUY || type==DEAL_TYPE_SELL) && (long)HistoryDealGetInteger(d,DEAL_MAGIC)!=InpMagicNumber)return false;
     }
   return true;
  }
int CountOwnPositions()
  {int n=0;for(int i=0;i<PositionsTotal();i++)if(PositionGetTicket(i)>0 && IsOwnPositionSelected())n++;return n;}
double NormalizePrice(const double price)
  {double step=SymbolInfoDouble(g_symbol,SYMBOL_TRADE_TICK_SIZE);return NormalizeDouble(MathRound(price/step)*step,g_digits);}
double MinimumStopDistance()
  {return ((double)MathMax(SymbolInfoInteger(g_symbol,SYMBOL_TRADE_STOPS_LEVEL),SymbolInfoInteger(g_symbol,SYMBOL_TRADE_FREEZE_LEVEL))+1)*g_point;}
bool IsSuccessfulRetcode(const uint code)
  {return code==TRADE_RETCODE_DONE || code==TRADE_RETCODE_DONE_PARTIAL;}
datetime ServerNow(){return TimeTradeServer();}
int OnInit()
  {
   if(MQLInfoInteger(MQL_TESTER)){Print("The network bridge is not used in Strategy Tester.");return INIT_FAILED;}
   if(StringLen(InpNABDToken)<32 || StringFind(InpNABDUrl,"https://")!=0 || InpMagicNumber<=0)
     {Print("Set your HTTPS dashboard URL and its private MT5 ingest token.");return INIT_PARAMETERS_INCORRECT;}
   g_symbol=StringLen(InpSymbol)>0?InpSymbol:_Symbol;
   if(!SymbolSelect(g_symbol,true))return INIT_FAILED;
   g_digits=(int)SymbolInfoInteger(g_symbol,SYMBOL_DIGITS);g_point=SymbolInfoDouble(g_symbol,SYMBOL_POINT);
   if(g_point<=0 || SymbolInfoDouble(g_symbol,SYMBOL_TRADE_TICK_SIZE)<=0)return INIT_FAILED;
   g_trade.SetExpertMagicNumber(InpMagicNumber);g_trade.SetDeviationInPoints(InpDeviationPoints);
   g_trade.SetTypeFillingBySymbol(g_symbol);g_trade.SetMarginMode();g_trade.SetAsyncMode(false);
   if(!EventSetTimer((int)MathMax(3,InpNABDRefreshSeconds)))return INIT_FAILED;
   Print("NABD bridge started. No trade entry; remote management requires opt-in in both EAs.");
   return INIT_SUCCEEDED;
  }
void OnTimer(){NABDOnTimer();}
void OnDeinit(const int reason){EventKillTimer();}
#include "NABD_Bridge.mqh"
