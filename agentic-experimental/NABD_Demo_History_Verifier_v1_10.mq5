// NABD Demo History Verifier v1.10
// STRICTLY READ-ONLY. No CTrade, OrderSend, position modification or Live support.
// Install as a separate Expert Advisor on a dedicated JustMarkets DEMO MT5 terminal.
// This is a second observation of the MT5 terminal, NOT broker-signed attestation.
#property strict
#property version "1.10"
#property description "NABD isolated Demo History verifier: read-only entry and closed position evidence"

input string InpGoldSymbol             = "XAUUSD.m";
input string InpBitcoinSymbol          = "BTCUSD.m";
input long   InpAllowedDemoLogin       = 0;      // Optional extra Demo account pin
input int    InpPollSeconds            = 15;     // 5..60
input string InpHistoryHmacSecret      = "";     // PRIVATE: isolated History key, >=32 ASCII chars
input bool   InpEnableHistoryUpload    = false;  // OFF until test Render key is configured

#define NABD_HISTORY_URL "https://nabd-agentic-ai-test.onrender.com/demo-history/observe"
#define NABD_CLOSURE_URL "https://nabd-agentic-ai-test.onrender.com/demo-history/closures"
#define NABD_MAGIC_GOLD 26111201
#define NABD_MAGIC_BTC  26111202

string g_state="NOT_STARTED";

string Lower(string s){StringToLower(s);return s;}
string I64(long n){return IntegerToString(n);}
string SafeJson(string s)
{
   StringReplace(s,"\\","\\\\");
   StringReplace(s,"\"","\\\"");
   StringReplace(s,"\r","");
   StringReplace(s,"\n"," ");
   return s;
}
bool SafeSymbol(const string sym)
{
   int n=StringLen(sym);
   if(n<1||n>64)return false;
   for(int i=0;i<n;i++)
   {
      ushort c=StringGetCharacter(sym,i);
      if((c>='a'&&c<='z')||(c>='A'&&c<='Z')||
         (c>='0'&&c<='9')||c=='.'||c=='_'||c=='-')continue;
      return false;
   }
   return true;
}
bool DemoOnly()
{
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
      return false;
   if(StringFind(Lower(AccountInfoString(ACCOUNT_SERVER)),"demo")<0)return false;
   long login=AccountInfoInteger(ACCOUNT_LOGIN);
   if(login<=0)return false;
   if(InpAllowedDemoLogin>0&&login!=InpAllowedDemoLogin)return false;
   return true;
}
void Utf8(string text,uchar &bytes[])
{
   int n=StringToCharArray(text,bytes,0,-1,CP_UTF8);
   if(n>0)ArrayResize(bytes,n-1);else ArrayResize(bytes,0);
}
bool Sha256(const uchar &raw[],uchar &digest[])
{
   uchar empty[];
   ArrayResize(empty,0);
   return CryptEncode(CRYPT_HASH_SHA256,raw,empty,digest)==32;
}
bool HmacSha256(string message,string &out)
{
   uchar key[],data[],inside[],outside[],first[],last[];
   Utf8(InpHistoryHmacSecret,key);
   Utf8(message,data);
   int len=ArraySize(key);
   if(len<32||len>128)return false;
   if(len>64)
   {
      if(!Sha256(key,last))return false;
      ArrayResize(key,32);
      ArrayCopy(key,last,0,0,32);
      len=32;
   }
   ArrayResize(inside,64+ArraySize(data));
   for(int i=0;i<64;i++)
   {
      uchar k=(uchar)(i<len?key[i]:0);
      inside[i]=(uchar)(k^0x36);
   }
   for(int i=0;i<ArraySize(data);i++)inside[64+i]=data[i];
   if(!Sha256(inside,first))return false;
   ArrayResize(outside,96);
   for(int i=0;i<64;i++)
   {
      uchar k=(uchar)(i<len?key[i]:0);
      outside[i]=(uchar)(k^0x5c);
   }
   for(int i=0;i<32;i++)outside[64+i]=first[i];
   if(!Sha256(outside,last))return false;
   out="";
   for(int i=0;i<32;i++)out+=StringFormat("%02x",(int)last[i]);
   return StringLen(out)==64;
}
bool HistoryJson(string &json,int &count)
{
   count=0;
   if(!DemoOnly())return false;
   long utc=(long)TimeGMT(),broker=(long)TimeTradeServer();
   // Deals use broker-server time. Convert to UTC for comparison to server ACK time.
   // A missing/unreasonable broker offset is fail-closed, never force a proof.
   if(utc<=0||broker<=0)return false;
   long offset=broker-utc;
   if(offset>16*3600||offset<(-16*3600))return false;
   if(!HistorySelect((datetime)(broker-900),(datetime)(broker+30)))return false;

   string rows="";
   const int available=HistoryDealsTotal();
   // Look at the most recent 100 broker records; send at most 20 matching entry fills.
   for(int i=available-1;i>=0 && i>=available-100 && count<20;i--)
   {
      ulong deal=HistoryDealGetTicket(i);
      if(deal==0)continue;
      long magic=HistoryDealGetInteger(deal,DEAL_MAGIC);
      if(magic!=NABD_MAGIC_GOLD&&magic!=NABD_MAGIC_BTC)continue;
      long kind=HistoryDealGetInteger(deal,DEAL_ENTRY);
      if(kind!=DEAL_ENTRY_IN)continue;
      long type=HistoryDealGetInteger(deal,DEAL_TYPE);
      if(type!=DEAL_TYPE_BUY&&type!=DEAL_TYPE_SELL)continue;
      string brokerSym=HistoryDealGetString(deal,DEAL_SYMBOL);
      string logical="";
      if(brokerSym==InpGoldSymbol&&magic==NABD_MAGIC_GOLD)logical="XAUUSD";
      else if(brokerSym==InpBitcoinSymbol&&magic==NABD_MAGIC_BTC)logical="BTCUSD";
      if(logical=="")continue;
      long dealTime=(long)HistoryDealGetInteger(deal,DEAL_TIME)-offset;
      if(dealTime<utc-900||dealTime>utc+2)continue;
      ulong order=(ulong)HistoryDealGetInteger(deal,DEAL_ORDER);
      if(order==0||!HistoryOrderSelect(order))continue;
      if(HistoryOrderGetString(order,ORDER_SYMBOL)!=brokerSym)continue;
      double sl=HistoryOrderGetDouble(order,ORDER_SL);
      double tp=HistoryOrderGetDouble(order,ORDER_TP);
      double volume=HistoryDealGetDouble(deal,DEAL_VOLUME);
      if(!MathIsValidNumber(sl)||!MathIsValidNumber(tp)||sl<=0||tp<=0||
         !MathIsValidNumber(volume)||volume<=0)continue;
      string row="{\"symbol\":\""+logical+"\",\"dealTicket\":"+I64((long)deal)+
        ",\"orderTicket\":"+I64((long)order)+
        ",\"brokerSymbol\":\""+brokerSym+"\",\"side\":\""+
        (type==DEAL_TYPE_BUY?"BUY":"SELL")+
        "\",\"entry\":\"IN\",\"dealAt\":"+I64(dealTime)+
        ",\"volume\":"+DoubleToString(volume,8)+
        ",\"stop\":"+DoubleToString(sl,8)+
        ",\"target\":"+DoubleToString(tp,8)+"}";
      if(count>0)rows+=",";
      rows+=row;
      count++;
   }
   string server=AccountInfoString(ACCOUNT_SERVER);
   json="{\"source\":\"ISOLATED_DEMO_MT5_HISTORY_VERIFIER\",\"accountType\":\"DEMO\","+
     "\"accountLogin\":"+I64(AccountInfoInteger(ACCOUNT_LOGIN))+
     ",\"brokerServer\":\""+SafeJson(server)+"\","+
     "\"observedAt\":"+I64(utc)+
     ",\"symbols\":{\"XAUUSD\":\""+InpGoldSymbol+
     "\",\"BTCUSD\":\""+InpBitcoinSymbol+"\"},"+
     "\"deals\":["+rows+"]}";
   return StringLen(json)<14000;
}

bool IsPositionOpen(ulong id)
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      if(PositionGetTicket(i)==0)return true;
      if((ulong)PositionGetInteger(POSITION_IDENTIFIER)==id)return true;
   }
   return false;
}
bool PositionRow(ulong id,long utc,long offset,string &row)
{
   row="";
   if(id==0||IsPositionOpen(id)||!HistorySelectByPosition(id))return false;
   int n=HistoryDealsTotal();
   if(n<2||n>25)return false;
   int ins=0,outs=0;
   double opened=0,closed=0;
   long entryType=-1,entryAt=0,closeAt=0;
   string logical="",brokerSym="",rows="";
   for(int i=0;i<n;i++)
   {
      ulong d=HistoryDealGetTicket(i);
      if(d==0||(ulong)HistoryDealGetInteger(d,DEAL_POSITION_ID)!=id)return false;
      long kind=HistoryDealGetInteger(d,DEAL_ENTRY),type=HistoryDealGetInteger(d,DEAL_TYPE);
      long magic=HistoryDealGetInteger(d,DEAL_MAGIC);
      string sym=HistoryDealGetString(d,DEAL_SYMBOL);
      string name="";
      if(sym==InpGoldSymbol&&magic==NABD_MAGIC_GOLD)name="XAUUSD";
      else if(sym==InpBitcoinSymbol&&magic==NABD_MAGIC_BTC)name="BTCUSD";
      if(name==""||(logical!=""&&name!=logical))return false;
      logical=name;brokerSym=sym;
      if((kind!=DEAL_ENTRY_IN&&kind!=DEAL_ENTRY_OUT)||(type!=DEAL_TYPE_BUY&&type!=DEAL_TYPE_SELL))return false;
      long at=(long)HistoryDealGetInteger(d,DEAL_TIME)-offset;
      double volume=0,profit=0,commission=0,swap=0,fee=0;
      if(at<=0||at>utc+2||!HistoryDealGetDouble(d,DEAL_VOLUME,volume)||
         !HistoryDealGetDouble(d,DEAL_PROFIT,profit)||!HistoryDealGetDouble(d,DEAL_COMMISSION,commission)||
         !HistoryDealGetDouble(d,DEAL_SWAP,swap)||!HistoryDealGetDouble(d,DEAL_FEE,fee))return false;
      if(!MathIsValidNumber(volume)||volume<=0||!MathIsValidNumber(profit)||!MathIsValidNumber(commission)||!MathIsValidNumber(swap)||!MathIsValidNumber(fee))return false;
      if(kind==DEAL_ENTRY_IN){ins++;opened+=volume;entryType=type;entryAt=at;}
      else{outs++;closed+=volume;if(at>closeAt)closeAt=at;}
      string item="{\"dealTicket\":"+I64((long)d)+",\"brokerSymbol\":\""+sym+
         "\",\"entry\":\""+(kind==DEAL_ENTRY_IN?"IN":"OUT")+"\",\"side\":\""+
         (type==DEAL_TYPE_BUY?"BUY":"SELL")+"\",\"at\":"+I64(at)+
         ",\"volume\":"+DoubleToString(volume,8)+",\"profit\":"+DoubleToString(profit,8)+
         ",\"commission\":"+DoubleToString(commission,8)+",\"swap\":"+DoubleToString(swap,8)+
         ",\"fee\":"+DoubleToString(fee,8)+"}";
      if(i>0)rows+=",";
      rows+=item;
   }
   if(ins!=1||outs<1||MathAbs(opened-closed)>0.00000001||closeAt<utc-86400||closeAt<entryAt||IsPositionOpen(id))return false;
   // Reject all exits not opposite to the entry; no reversal or close-by attribution.
   for(int j=0;j<n;j++)
   {
      ulong d=HistoryDealGetTicket(j);
      if(d==0)return false;
      if(HistoryDealGetInteger(d,DEAL_ENTRY)==DEAL_ENTRY_OUT&&
         (HistoryDealGetInteger(d,DEAL_TYPE)==entryType||(long)HistoryDealGetInteger(d,DEAL_TIME)-offset<entryAt))return false;
   }
   row="{\"symbol\":\""+logical+"\",\"positionId\":"+I64((long)id)+
       ",\"positionOpen\":false,\"deals\":["+rows+"]}";
   return true;
}
bool ClosedJson(string &json,int &count)
{
   count=0;
   if(!DemoOnly()||AccountInfoInteger(ACCOUNT_MARGIN_MODE)!=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)return false;
   long utc=(long)TimeGMT(),broker=(long)TimeTradeServer(),offset=broker-utc;
   if(utc<=0||broker<=0||offset>16*3600||offset<(-16*3600))return false;
   if(!HistorySelect((datetime)(broker-86400),(datetime)(broker+30)))return false;
   ulong ids[];ArrayResize(ids,0);
   int n=HistoryDealsTotal();
   // Snapshot position identifiers before HistorySelectByPosition changes the selected list.
   for(int i=n-1;i>=0&&ArraySize(ids)<60;i--)
   {
      ulong d=HistoryDealGetTicket(i);
      if(d==0||HistoryDealGetInteger(d,DEAL_ENTRY)!=DEAL_ENTRY_OUT)continue;
      long magic=HistoryDealGetInteger(d,DEAL_MAGIC);
      if(magic!=NABD_MAGIC_GOLD&&magic!=NABD_MAGIC_BTC)continue;
      ulong id=(ulong)HistoryDealGetInteger(d,DEAL_POSITION_ID);
      bool duplicate=false;
      for(int j=0;j<ArraySize(ids);j++)if(ids[j]==id){duplicate=true;break;}
      if(id==0||duplicate)continue;
      int k=ArraySize(ids);ArrayResize(ids,k+1);ids[k]=id;
   }
   string rows="";
   for(int i=0;i<ArraySize(ids)&&count<20;i++)
   {
      string row="";
      if(!PositionRow(ids[i],utc,offset,row))continue;
      if(StringLen(rows)+StringLen(row)>58000)break;
      if(count>0)rows+=",";
      rows+=row;count++;
   }
   string currency=AccountInfoString(ACCOUNT_CURRENCY);
   json="{\"source\":\"ISOLATED_DEMO_MT5_CLOSED_HISTORY_V1\",\"accountType\":\"DEMO\",\"marginMode\":\"HEDGING\",\"accountLogin\":"+
      I64(AccountInfoInteger(ACCOUNT_LOGIN))+",\"brokerServer\":\""+SafeJson(AccountInfoString(ACCOUNT_SERVER))+
      "\",\"observedAt\":"+I64(utc)+",\"currency\":\""+SafeJson(currency)+
      "\",\"symbols\":{\"XAUUSD\":\""+InpGoldSymbol+"\",\"BTCUSD\":\""+InpBitcoinSymbol+
      "\"},\"positions\":["+rows+"]}";
   return StringLen(json)<60000;
}

bool PostReadOnly(string json,int &http,string &response,bool closures=false)
{
   http=-1;response="";
   long now=(long)TimeGMT();
   string stamp=I64(now),signature="";
   if(!HmacSha256((closures?"NABD_CLOSED_HISTORY_V1\n":"")+stamp+"\n"+json,signature))return false;
   uchar utf[];Utf8(json,utf);
   char body[];ArrayResize(body,ArraySize(utf));
   for(int i=0;i<ArraySize(utf);i++)body[i]=(char)utf[i];
   string headers="Content-Type: application/json\r\n"+
      "X-NABD-History-Timestamp: "+stamp+"\r\n"+
      "X-NABD-History-Signature: "+signature+"\r\n";
   char result[];string responseHeaders="";
   ResetLastError();
   http=WebRequest("POST",(closures?NABD_CLOSURE_URL:NABD_HISTORY_URL),headers,8000,body,result,responseHeaders);
   if(http!=202)return false;
   uchar reply[];ArrayResize(reply,ArraySize(result));
   for(int i=0;i<ArraySize(result);i++)reply[i]=(uchar)result[i];
   response=CharArrayToString(reply,0,ArraySize(reply),CP_UTF8);
   return StringFind(response,"\"status\":\"OBSERVED\"")>=0 &&
          StringFind(response,"\"ordersCreated\":0")>=0;
}
int OnInit()
{
   if(!DemoOnly())
   {Print("[NABD HISTORY] BLOCKED_DEMO_ACCOUNT_REQUIRED");return INIT_FAILED;}
   if(!SafeSymbol(InpGoldSymbol)||!SafeSymbol(InpBitcoinSymbol)||
      InpGoldSymbol==InpBitcoinSymbol||InpPollSeconds<5||InpPollSeconds>60)
      return INIT_PARAMETERS_INCORRECT;
   if(InpEnableHistoryUpload && StringLen(InpHistoryHmacSecret)<32)
   {Print("[NABD HISTORY] PRIVATE_HISTORY_HMAC_KEY_REQUIRED");return INIT_PARAMETERS_INCORRECT;}
   if(!EventSetTimer(InpPollSeconds))return INIT_FAILED;
   g_state=InpEnableHistoryUpload?"STARTED_READ_ONLY":"LOCAL_READ_ONLY_DISABLED_UPLOAD";
   Print("[NABD HISTORY] ",g_state,"; NO_ORDER_ROUTES");
   Comment("NABD Demo History Verifier: ",g_state);
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){EventKillTimer();Comment("");}
void OnTick(){} // Important: no tick-driven trading or order placement.
void OnTimer()
{
   if(!DemoOnly()){g_state="DEMO_IDENTITY_LOST";Comment(g_state);return;}
   string payload="";int count=0;
   if(!HistoryJson(payload,count))
   {g_state="HISTORY_UNAVAILABLE";Comment(g_state);return;}
   if(!InpEnableHistoryUpload)
   {
      g_state="READ_ONLY_LOCAL (recent qualifying deals="+IntegerToString(count)+")";
      Comment(g_state);
      return;
   }
   int http=0;string reply="";
   if(PostReadOnly(payload,http,reply))
      g_state="READ_ONLY_VERIFIED_UPLOAD (deals="+IntegerToString(count)+")";
   else
      g_state="HISTORY_UPLOAD_FAILED (HTTP="+IntegerToString(http)+
         ", terminal error="+IntegerToString(GetLastError())+")";
   string closePayload="";int closeCount=0,closeHttp=0;string closeReply="";
   if(ClosedJson(closePayload,closeCount))
   {
      if(PostReadOnly(closePayload,closeHttp,closeReply,true))Print("[NABD HISTORY V1.10] CLOSED_READ_ONLY_UPLOAD (positions=",closeCount,")");
      else Print("[NABD HISTORY V1.10] CLOSED_UPLOAD_FAILED HTTP=",closeHttp);
   }
   else Print("[NABD HISTORY V1.10] CLOSED_HISTORY_UNAVAILABLE_OR_NOT_HEDGING");
   Comment("NABD History: ",g_state,"\nNo trades; no live execution");
   Print("[NABD HISTORY] ",g_state);
}
