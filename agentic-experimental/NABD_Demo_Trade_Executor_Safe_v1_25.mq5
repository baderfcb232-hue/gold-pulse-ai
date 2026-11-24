// NABD Agentic AI -- separate, strictly DEMO-only automatic execution terminal.
// SAFE TEMPLATE: no HMAC secret embedded. Enter the Demo-only key as a local MT5 input.
// Does not use production endpoints, passwords, or account switching.
#property strict
#property version "1.25"
#property description "NABD isolated JustMarkets DEMO AI executor - never LIVE"
#include <Trade/Trade.mqh>

input bool   InpEnableDemoAutoTrading = false; // Demo execution OFF until preflight is verified.
input string InpExecHmacSecret = ""; // Private DEMO exec key, >=32 ASCII chars. NEVER SHARE.
input string InpGoldSymbol = "XAUUSD.m";
input string InpBtcSymbol = "BTCUSD.m";
input int    InpPollSeconds = 4;
input int    InpDeviationPoints = 25;
input int    InpMaxTradesPerDay = 8; // COMBINED XAUUSD+BTCUSD limit, no more than 8.
input int    InpMaxBtcTradesPerDay = 6; // BTCUSD only, no more than 6.
input double InpMaxDailyEquityLossPct = 2.0;
input long   InpAllowedDemoAccountLogin = 0; // Optional additional login pin.

#define NABD_HEARTBEAT_URL "https://nabd-agentic-ai-test.onrender.com/demo-trade/heartbeat"
#define NABD_PULL_URL "https://nabd-agentic-ai-test.onrender.com/demo-trade/pull"
#define NABD_ACK_URL  "https://nabd-agentic-ai-test.onrender.com/demo-trade/ack"
#define NABD_MAGIC_GOLD 26111201
#define NABD_MAGIC_BTC  26111202

CTrade g_trade;
string g_status = "STARTING";
string g_heartbeat = "HEARTBEAT PENDING";
long g_lastHeartbeat = 0;

string I64(long n) { return IntegerToString(n); }
string N(double v) { return DoubleToString(v,8); }
string Lower(string value) { StringToLower(value); return value; }
string JsonEscape(string s)
{
   StringReplace(s,"\\","\\\\");
   StringReplace(s,"\"","\\\"");
   StringReplace(s,"\r","");
   StringReplace(s,"\n"," ");
   return s;
}

bool ValidBrokerSymbol(string s)
{
   if(StringLen(s)<1||StringLen(s)>64)return false;
   for(int i=0;i<StringLen(s);i++)
   {
      ushort x=StringGetCharacter(s,i);
      if((x>='a'&&x<='z')||(x>='A'&&x<='Z')||(x>='0'&&x<='9')||
          x=='.'||x=='_'||x=='-')continue;
      return false;
   }
   return true;
}

void Utf8(string value, uchar &bytes[])
{
   int n=StringToCharArray(value,bytes,0,-1,CP_UTF8);
   if(n>0) ArrayResize(bytes,n-1);
   else ArrayResize(bytes,0);
}

bool Sha256(const uchar &data[], uchar &digest[])
{
   uchar empty[];
   ArrayResize(empty,0);
   return CryptEncode(CRYPT_HASH_SHA256,data,empty,digest)==32;
}

bool Hmac(string text,string &hex)
{
   uchar key[],message[],inside[],outside[],a[],d[];
   Utf8(InpExecHmacSecret,key); Utf8(text,message);
   int n=ArraySize(key);
   if(n<32||n>128) return false;
   if(n>64)
   {
      if(!Sha256(key,d)) return false;
      ArrayResize(key,32); ArrayCopy(key,d,0,0,32);
      n=32;
   }
   ArrayResize(inside,64+ArraySize(message));
   for(int i=0;i<64;i++)
   {
      uchar k=(uchar)(i<n?key[i]:0);
      inside[i]=(uchar)(k ^ 0x36);
   }
   for(int i=0;i<ArraySize(message);i++) inside[64+i]=message[i];
   if(!Sha256(inside,a))return false;
   ArrayResize(outside,96);
   for(int i=0;i<64;i++)
   {
      uchar k=(uchar)(i<n?key[i]:0);
      outside[i]=(uchar)(k ^ 0x5c);
   }
   for(int i=0;i<32;i++) outside[64+i]=a[i];
   if(!Sha256(outside,d))return false;
   hex="";
   for(int i=0;i<32;i++) hex+=StringFormat("%02x",(int)d[i]);
   return StringLen(hex)==64;
}

bool OnDemoAccount()
{
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)return false;
   string server=AccountInfoString(ACCOUNT_SERVER);
   if(StringFind(Lower(server),"demo")<0)return false;
   long login=AccountInfoInteger(ACCOUNT_LOGIN);
   if(login<=0)return false;
   if(InpAllowedDemoAccountLogin>0&&login!=InpAllowedDemoAccountLogin)return false;
   return true;
}

bool SignedPost(const string url,const string json,string &reply,int &http)
{
   reply=""; http=-1;
   long now=(long)TimeGMT();
   string ts=I64(now),sig="";
   if(!Hmac((url==NABD_HEARTBEAT_URL?"NABD_HEARTBEAT_V1\n":"")+ts+"\n"+json,sig))return false;
   uchar body[];Utf8(json,body);
   char post[];ArrayResize(post,ArraySize(body));
   for(int i=0;i<ArraySize(body);i++)post[i]=(char)body[i];
   string headers="Content-Type: application/json\r\nX-NABD-Exec-Timestamp: "+ts+
                  "\r\nX-NABD-Exec-Signature: "+sig+"\r\n";
   char result[];string responseHeaders="";
   ResetLastError();
   http=WebRequest("POST",url,headers,8000,post,result,responseHeaders);
   if(http<=0)return false;
   uchar utf[];ArrayResize(utf,ArraySize(result)+1);
   for(int i=0;i<ArraySize(result);i++)utf[i]=(uchar)result[i];
   utf[ArraySize(result)]=0;
   reply=CharArrayToString(utf,0,ArraySize(result),CP_UTF8);
   return http==200;
}

string JsonWire(const string reply)
{
   string prefix="\"wire\":\"";
   int p=StringFind(reply,prefix);
   if(p<0)return "";
   p+=StringLen(prefix);
   int end=StringFind(reply,"\"",p);
   if(end<p)return "";
   string wire=StringSubstr(reply,p,end-p);
   if(StringLen(wire)>400)return "";
   return wire;
}

bool RoundPrice(const string symbol,double value,double &out)
{
   double step=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_SIZE);
   if(step<=0||value<=0)return false;
   int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   out=NormalizeDouble(MathRound(value/step)*step,digits);
   return out>0&&MathIsValidNumber(out);
}

int CountPositions(const string symbol)
{
   int count=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket>0&&PositionGetString(POSITION_SYMBOL)==symbol)count++;
   }
   return count;
}

int CountOurTradesToday(const string brokerSymbol="")
{
   datetime brokerTime=TimeTradeServer();
   if(brokerTime<=0)return 1000000; // Fail closed if broker time unavailable.
   MqlDateTime now;TimeToStruct(brokerTime,now);
   now.hour=0;now.min=0;now.sec=0;
   datetime start=StructToTime(now);
   if(!HistorySelect(start,brokerTime+60))return 1000000;
   // Count unique entry ORDERS, not split fills; a partially filled
   // order must not consume multiple daily slots. Include netting reversals.
   ulong seenOrders[];
   int count=0;
   for(int i=0;i<HistoryDealsTotal();i++)
   {
      ulong ticket=HistoryDealGetTicket(i);
      if(ticket==0)continue;
      long magic=HistoryDealGetInteger(ticket,DEAL_MAGIC);
      if(magic!=NABD_MAGIC_GOLD&&magic!=NABD_MAGIC_BTC)continue;
      long entryKind=HistoryDealGetInteger(ticket,DEAL_ENTRY);
      if(entryKind!=DEAL_ENTRY_IN&&entryKind!=DEAL_ENTRY_INOUT)continue;
      if(brokerSymbol!=""&&HistoryDealGetString(ticket,DEAL_SYMBOL)!=brokerSymbol)continue;
      ulong order=(ulong)HistoryDealGetInteger(ticket,DEAL_ORDER);
      if(order==0)order=ticket;
      bool duplicate=false;
      for(int j=0;j<count;j++)if(seenOrders[j]==order){duplicate=true;break;}
      if(duplicate)continue;
      ArrayResize(seenOrders,count+1);
      seenOrders[count]=order;
      count++;
   }
   return count;
}

bool DailyEquityGuard()
{
   datetime brokerTime=TimeTradeServer();
   if(brokerTime<=0)return false;
   MqlDateTime d;TimeToStruct(brokerTime,d);
   string day=StringFormat("%04d%02d%02d",d.year,d.mon,d.day);
   string key="NABD.DEMO.START_EQUITY."+I64(AccountInfoInteger(ACCOUNT_LOGIN))+"."+day;
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   if(equity<=0)return false;
   if(!GlobalVariableCheck(key))GlobalVariableSet(key,equity);
   double baseline=GlobalVariableGet(key);
   if(baseline<=0||equity<baseline*(1.0-InpMaxDailyEquityLossPct/100.0))return false;
   return true;
}

void AuditFill(const string intentId,const string outcome,const ulong dealTicket,const uint tradeRetcode,const double executedVolume)
{
   string body="{\"id\":\""+intentId+"\",\"status\":\""+
      outcome+"\",\"accountType\":\"DEMO\",\"accountLogin\":"+
      I64(AccountInfoInteger(ACCOUNT_LOGIN))+",\"occurredAt\":"+I64((long)TimeGMT())+
      ",\"brokerDealTicket\":"+I64((long)dealTicket)+
      ",\"tradeRetcode\":"+I64((long)tradeRetcode)+
      ",\"executedVolume\":"+N(executedVolume)+"}";
   // ACK is audit-only. Retry the *same already-executed result* once on network
   // failure. This NEVER retries the broker order. Server ACK is idempotent.
   for(int attempt=1;attempt<=2;attempt++)
   {
      string response="";int code=0;
      if(SignedPost(NABD_ACK_URL,body,response,code))return;
      Print("[NABD DEMO EXECUTOR] ACK send failed (order NOT retried), attempt=",
         attempt," HTTP=",code," deal=",(long)dealTicket,
         " retcode=",(long)tradeRetcode);
      if(attempt==1)Sleep(350);
   }
   Print("[NABD DEMO EXECUTOR] ACK UNCONFIRMED: inspect MT5 History and Render status; no replay of order");
}

bool ExecuteWire(const string wire)
{
   string f[];int count=StringSplit(wire,'|',f);
   if(count!=14||f[0]!="V1")return false;
   string payload=StringSubstr(wire,0,StringLen(wire)-StringLen(f[13])-1);
   string expected="";
   if(!Hmac(payload,expected)||expected!=f[13])
   { Print("[NABD DEMO EXECUTOR] Invalid signed trading intent");return false; }
   string id=f[1],logical=f[2],side=f[3];
   if(logical!="XAUUSD"&&logical!="BTCUSD")return false;
   string sym=(logical=="XAUUSD"?InpGoldSymbol:InpBtcSymbol);
   if(id!=logical+"-"+f[4]||(side!="BUY"&&side!="SELL"))return false;
   long bar=(long)StringToInteger(f[4]);
   long issued=(long)StringToInteger(f[5]),expires=(long)StringToInteger(f[6]);
   long now=(long)TimeGMT();
   if(bar<=0||issued<=0||now<issued-2||now>expires||expires-issued>20)return false;
   double ref=StringToDouble(f[7]),sl=StringToDouble(f[8]),tp=StringToDouble(f[9]);
   double risk=StringToDouble(f[10]),spreadLimit=StringToDouble(f[11]);
   int maxPositions=(int)StringToInteger(f[12]);
   if(!MathIsValidNumber(ref)||!MathIsValidNumber(sl)||!MathIsValidNumber(tp)||
      ref<=0||sl<=0||tp<=0||risk<=0||risk>0.400001||
      spreadLimit<=0||spreadLimit>(logical=="BTCUSD"?80.0:2.5)||
      maxPositions!=(logical=="BTCUSD"?2:1))return false;
   if(!OnDemoAccount()||!InpEnableDemoAutoTrading)return false;
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)||!MQLInfoInteger(MQL_TRADE_ALLOWED)||
      !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))return false;
   if(!SymbolSelect(sym,true)||SymbolInfoInteger(sym,SYMBOL_TRADE_MODE)!=SYMBOL_TRADE_MODE_FULL)return false;
   MqlTick tick;
   if(!SymbolInfoTick(sym,tick)||tick.bid<=0||tick.ask<=tick.bid||
      tick.time>now||now-(long)tick.time>2)return false;
   const bool buy=(side=="BUY");
   double entry=(buy?tick.ask:tick.bid),spread=tick.ask-tick.bid;
   if(spread>spreadLimit||spread<=0||MathAbs(entry-ref)>MathMax(spreadLimit*0.25,MathAbs(ref-sl)*0.15))return false;
   if((buy&&!(sl<tick.bid&&tp>entry))||(!buy&&!(tp<entry&&sl>tick.ask)))return false;
   double roundedStop=0.0,roundedTarget=0.0;
   if(!RoundPrice(sym,sl,roundedStop)||!RoundPrice(sym,tp,roundedTarget))return false;
   double riskDistance=MathAbs(entry-roundedStop),rewardDistance=MathAbs(roundedTarget-entry);
   if(riskDistance<=0||rewardDistance/riskDistance<(logical=="BTCUSD"?2.999:1.999))return false;
   double minDistance=(double)SymbolInfoInteger(sym,SYMBOL_TRADE_STOPS_LEVEL)*SymbolInfoDouble(sym,SYMBOL_POINT);
   if((buy&&((tick.bid-roundedStop)<minDistance||(roundedTarget-tick.ask)<minDistance))||
      (!buy&&((roundedStop-tick.ask)<minDistance||(tick.bid-roundedTarget)<minDistance)))return false;
   if(!DailyEquityGuard()||CountOurTradesToday()>=InpMaxTradesPerDay)return false;
   if(logical=="BTCUSD"&&CountOurTradesToday(sym)>=InpMaxBtcTradesPerDay)return false;
   int cap=maxPositions;
   if(AccountInfoInteger(ACCOUNT_MARGIN_MODE)!=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)cap=1;
   if(CountPositions(sym)>=cap||PositionsTotal()>=3)return false;
   string lastKey="NABD.DEMO.LAST_BAR."+I64(AccountInfoInteger(ACCOUNT_LOGIN))+"."+logical;
   if(GlobalVariableCheck(lastKey)&&GlobalVariableGet(lastKey)>=(double)bar)return false;
   ENUM_ORDER_TYPE type=(buy?ORDER_TYPE_BUY:ORDER_TYPE_SELL);
   double oneLotProfit=0.0;
   if(!OrderCalcProfit(type,sym,1.0,entry,roundedStop,oneLotProfit)||oneLotProfit>=0)return false;
   double riskMoney=AccountInfoDouble(ACCOUNT_EQUITY)*risk/100.0;
   double step=SymbolInfoDouble(sym,SYMBOL_VOLUME_STEP);
   double vmin=SymbolInfoDouble(sym,SYMBOL_VOLUME_MIN);
   double vmax=SymbolInfoDouble(sym,SYMBOL_VOLUME_MAX);
   if(riskMoney<=0||step<=0||vmin<=0||vmax<vmin)return false;
   double rawLots=riskMoney/MathAbs(oneLotProfit);
   double lot=NormalizeDouble(MathFloor(rawLots/step+1e-8)*step,8);
   if(lot<vmin||lot>vmax)return false;
   double predicted=0.0;
   if(!OrderCalcProfit(type,sym,lot,entry,roundedStop,predicted)||predicted>=0||
      MathAbs(predicted)>riskMoney*1.0001)return false;
   double margin=0.0;
   if(!OrderCalcMargin(type,sym,lot,entry,margin)||margin<=0||
      margin>AccountInfoDouble(ACCOUNT_MARGIN_FREE)*0.8)return false;
   // Persist duplicate barrier before contacting the broker. A timeout never retries.
   if(GlobalVariableSet(lastKey,(double)bar)==0)
   { Print("[NABD DEMO EXECUTOR] BLOCKED: failed to persist one-order-per-bar guard");return false; }
   g_trade.SetExpertMagicNumber((ulong)(logical=="BTCUSD"?NABD_MAGIC_BTC:NABD_MAGIC_GOLD));
   g_trade.SetDeviationInPoints((ulong)MathMax(0,MathMin(100,InpDeviationPoints)));
   g_trade.SetAsyncMode(false);
   if(!g_trade.SetTypeFillingBySymbol(sym))return false;
   bool sent=buy?g_trade.Buy(lot,sym,0,roundedStop,roundedTarget,"NABD-"+id):
                  g_trade.Sell(lot,sym,0,roundedStop,roundedTarget,"NABD-"+id);
   uint retcode=g_trade.ResultRetcode();
   ulong deal=g_trade.ResultDeal();
   double executedVolume=g_trade.ResultVolume();
   // A positive CTrade result is NOT proof the broker opened a position.
   // Verify the returned deal is visible in the terminal's broker history.
   const bool settled=(retcode==TRADE_RETCODE_DONE||retcode==TRADE_RETCODE_DONE_PARTIAL);
   bool foundDeal=(deal>0 && HistoryDealSelect(deal));
   bool confirmed=sent&&settled&&foundDeal&&
      (long)HistoryDealGetInteger(deal,DEAL_MAGIC)==(logical=="BTCUSD"?NABD_MAGIC_BTC:NABD_MAGIC_GOLD)&&
      HistoryDealGetString(deal,DEAL_SYMBOL)==sym&&
      HistoryDealGetInteger(deal,DEAL_ENTRY)==DEAL_ENTRY_IN&&
      HistoryDealGetDouble(deal,DEAL_VOLUME)>0.0;
   string outcome=confirmed?"FILLED":
      (settled||retcode==TRADE_RETCODE_PLACED)?"UNCERTAIN":"REJECTED";
   double confirmedVolume=confirmed?HistoryDealGetDouble(deal,DEAL_VOLUME):0.0;
   Print("[NABD DEMO EXECUTOR] ",id," sent=",sent," retcode=",retcode,
         " requestedLot=",N(lot)," deal=",(long)deal,
         " outcome=",outcome," reason=",g_trade.ResultRetcodeDescription());
   AuditFill(id,outcome,deal,retcode,confirmedVolume);
   g_status="DEMO ORDER "+outcome+" "+id;
   return confirmed;
}

// Transport-only probe. Never pulls an intent or calls any trade method.
void SendReadOnlyHeartbeat()
{
   if(!OnDemoAccount())return;
   if(!ValidBrokerSymbol(InpGoldSymbol)||!ValidBrokerSymbol(InpBtcSymbol)||InpGoldSymbol==InpBtcSymbol)
   {g_heartbeat="HEARTBEAT INVALID SYMBOL MAPPING";return;}
   long now=(long)TimeGMT();
   if(g_lastHeartbeat>0&&now>=g_lastHeartbeat&&now-g_lastHeartbeat<20)return;
   g_lastHeartbeat=now;
   bool armed=InpEnableDemoAutoTrading&&TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)&&
      MQLInfoInteger(MQL_TRADE_ALLOWED)&&AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);
   string request="{\"source\":\"ISOLATED_DEMO_EXECUTOR_HEARTBEAT\",\"version\":\"1.25\",\"accountType\":\"DEMO\",\"accountLogin\":"+
      I64(AccountInfoInteger(ACCOUNT_LOGIN))+",\"brokerServer\":\""+JsonEscape(AccountInfoString(ACCOUNT_SERVER))+
      "\",\"brokerSymbols\":{\"XAUUSD\":\""+JsonEscape(InpGoldSymbol)+"\",\"BTCUSD\":\""+JsonEscape(InpBtcSymbol)+
      "\"},\"capturedAt\":"+I64(now)+",\"armed\":"+(armed?"true":"false")+"}";
   string reply="";int http=-1;
   SignedPost(NABD_HEARTBEAT_URL,request,reply,http);
   // Only a known bounded server label is displayed; never echo request or response bodies.
   string reason="HTTP_"+I64((long)http);
   if(http<0)reason="WEBREQUEST_FAILED";
   else if(StringFind(reply,"\"status\":\"HEARTBEAT_MATCHED\"")>=0)reason="HEARTBEAT_MATCHED";
   else if(StringFind(reply,"\"status\":\"HEARTBEAT_WAITING_SENSOR\"")>=0)reason="HEARTBEAT_WAITING_SENSOR";
   else if(StringFind(reply,"\"status\":\"HEARTBEAT_FEED_MISMATCH\"")>=0)reason="HEARTBEAT_FEED_MISMATCH";
   else if(StringFind(reply,"\"status\":\"HEARTBEAT_SIGNATURE_INVALID\"")>=0)reason="HEARTBEAT_SIGNATURE_INVALID";
   else if(StringFind(reply,"\"status\":\"HEARTBEAT_EXPIRED\"")>=0)reason="HEARTBEAT_EXPIRED";
   string next="NABD v1.25 "+reason+(armed?" (ARMED)":" (READ ONLY)");
   if(next!=g_heartbeat)Print("[NABD DEMO HEARTBEAT] ",next);
   g_heartbeat=next;
}

void PollDemoOrders()
{
   if(!OnDemoAccount())
   {
      g_status="BLOCKED: only a genuine Demo account is allowed";
      Comment(g_status);return;
   }
   if(!InpEnableDemoAutoTrading)
   {
      g_status="DEMO AUTOTRADING DISABLED by input";
      Comment(g_status);return;
   }
   // Do not consume a one-shot intent if MetaTrader disallows trading.
   // An operator must explicitly enable Algo Trading on this DEMO terminal.
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)||
      !MQLInfoInteger(MQL_TRADE_ALLOWED)||
      !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
   {
      g_status="NABD DEMO NOT ARMED: Algo Trading disabled (no intent pulled)";
      Comment(g_status);return;
   }
   // Seed the equity baseline as soon as execution is enabled, not when
   // the first order appears. The baseline persists across MT5 restarts.
   if(!DailyEquityGuard())
   {
      g_status="NABD DEMO BLOCKED: daily equity stop or broker clock unavailable";
      Comment(g_status);return;
   }
   if(!ValidBrokerSymbol(InpGoldSymbol)||!ValidBrokerSymbol(InpBtcSymbol)||
      InpGoldSymbol==InpBtcSymbol)
   {
      g_status="NABD DEMO BLOCKED: invalid broker symbol mapping";
      Comment(g_status);return;
   }
   long now=(long)TimeGMT();
   string request="{\"source\":\"ISOLATED_DEMO_TRADE_EXECUTOR\",\"accountType\":\"DEMO\",\"accountLogin\":"+
      I64(AccountInfoInteger(ACCOUNT_LOGIN))+",\"brokerServer\":\""+
      JsonEscape(AccountInfoString(ACCOUNT_SERVER))+"\",\"symbols\":[\"XAUUSD\",\"BTCUSD\"],"+
      "\"brokerSymbols\":{\"XAUUSD\":\""+JsonEscape(InpGoldSymbol)+
      "\",\"BTCUSD\":\""+JsonEscape(InpBtcSymbol)+"\"},\"capturedAt\":"+I64(now)+"}";
   string reply="";int http=-1;
   if(!SignedPost(NABD_PULL_URL,request,reply,http))
   {
      g_status="NABD DEMO pull failed HTTP="+I64((long)http)+" "+StringSubstr(reply,0,180);
      Print("[NABD DEMO EXECUTOR] ",g_status);
      Comment(g_status);return;
   }
   string wire=JsonWire(reply);
   if(wire=="")g_status="NABD DEMO ONLINE - waiting for verified AI intent";
   else if(!ExecuteWire(wire))g_status="NABD DEMO order rejected by safety rules";
   Comment(g_status,"\nEXECUTOR: Demo only. Trading requires Algo Trading enabled.");
}

int OnInit()
{
   if(!OnDemoAccount())
   { Print("[NABD DEMO EXECUTOR] FAIL-CLOSED: this account is not DEMO");return INIT_FAILED; }
   if(StringLen(InpExecHmacSecret)<32||StringLen(InpExecHmacSecret)>128||
      InpPollSeconds<3||InpPollSeconds>30||InpMaxDailyEquityLossPct<=0||
      InpMaxDailyEquityLossPct>2||InpMaxTradesPerDay<1||InpMaxTradesPerDay>8||
      InpMaxBtcTradesPerDay<1||InpMaxBtcTradesPerDay>6)
   {
      Print("[NABD DEMO EXECUTOR] BLOCKED: missing private HMAC key or invalid risk limits");
      return INIT_FAILED;
   }
   int seconds=MathMax(3,MathMin(30,InpPollSeconds));
   if(!EventSetTimer(seconds))return INIT_FAILED;
   Comment("NABD DEMO Executor v1.25 - isolated demo-only; check inputs");
   Print("[NABD DEMO EXECUTOR] Started on Demo. No LIVE execution supported.");
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){EventKillTimer();Comment("");}
void OnTick(){}
void OnTimer(){SendReadOnlyHeartbeat();PollDemoOrders();Comment(g_status,"\n",g_heartbeat);}