// NABD Phase 12 — PAUSE-only companion for JustMarkets Demo.
// EXPERIMENTAL SOURCE: requires MetaEditor compilation + isolated Demo forward verification.
// Installing and arming this EA immediately and permanently blocks NEW entries
// for this account+exact symbol in the matching NABD main EA. Never closes positions.
#property strict
#property version "1.00"
#property description "Phase 12 Demo stop-only adapter, NO trading or resume"
input bool   InpExplicitDemoPauseArm = false; // MUST opt in; no trades while armed
input string InpStagingHttpsBase = "";       // Isolated staging URL ONLY; never Live
input string InpAccountId = "";              // Registered Demo UUID
input string InpPauseOnlyToken = "";         // Separate stop executor token, NEVER ingest token
input int    InpStopPollSeconds = 5;
input int    InpStopHttpTimeoutMs = 2500;

uint P12Hash(const string value)
  {
   uint hash=2166136261;
   for(int i=0;i<StringLen(value);i++)hash=(hash^(uint)StringGetCharacter(value,i))*16777619;
   return hash;
  }
string P12Key()
  {return StringFormat("NB_P12_%I64d_%u",AccountInfoInteger(ACCOUNT_LOGIN),P12Hash(_Symbol));}
string P12Quote(const string value)
  {
   string s=value;
   StringReplace(s,"\\","\\\\");
   StringReplace(s,"\"","\\\"");
   return "\""+s+"\"";
  }
bool P12Uuid(const string s)
  {
   if(StringLen(s)!=36)return false;
   for(int i=0;i<36;i++)
     {
      ushort c=StringGetCharacter(s,i);
      if(i==8 || i==13 || i==18 || i==23){if(c!=45)return false;continue;}
      if(!((c>=48 && c<=57)||(c>=97 && c<=102)))return false;
     }
   return true;
  }
bool P12PausePersisted()
  {
   // GlobalVariablesFlush must complete before any network acknowledgment.
   string key=P12Key();
   return GlobalVariableCheck(key) && GlobalVariableGet(key)>0.5;
  }
void P12SetPause()
  {
   if(GlobalVariableSet(P12Key(),1.0)==0)
      {Print("NABD phase12 failed to persist PAUSE: ",GetLastError());return;}
   GlobalVariablesFlush();
  }
bool P12DemoIdentity()
  {
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)return false;
   string company=AccountInfoString(ACCOUNT_COMPANY);StringToLower(company);
   string server=AccountInfoString(ACCOUNT_SERVER);string serverLower=server;StringToLower(serverLower);
   if(StringFind(company,"justmarkets")<0 && StringFind(serverLower,"justmarkets")<0)return false;
   return AccountInfoInteger(ACCOUNT_LOGIN)>0 && StringLen(server)>0;
  }
string P12Identity()
  {
   return "\"accountId\":"+P12Quote(InpAccountId)+
     ",\"broker\":\"JustMarkets\",\"server\":"+P12Quote(AccountInfoString(ACCOUNT_SERVER))+
     ",\"login\":"+P12Quote((string)AccountInfoInteger(ACCOUNT_LOGIN))+
     ",\"environment\":\"demo\",\"demo_mode\":true";
  }
int P12Request(const string path,const string packet,string &reply)
  {
   char data[],response[];
   StringToCharArray(packet,data,0,WHOLE_ARRAY,CP_UTF8);
   if(ArraySize(data)>0)ArrayResize(data,ArraySize(data)-1);
   string headers="Content-Type: application/json\r\nX-NABD-Stop-Token: "+InpPauseOnlyToken+"\r\n";
   string responseHeaders;
   ResetLastError();
   int code=WebRequest("POST",InpStagingHttpsBase+path,headers,InpStopHttpTimeoutMs,
                       data,response,responseHeaders);
   reply=CharArrayToString(response,0,WHOLE_ARRAY,CP_UTF8);
   return code;
  }
int OnInit()
  {
   if(!InpExplicitDemoPauseArm || !P12DemoIdentity() || !P12Uuid(InpAccountId) ||
      StringLen(InpPauseOnlyToken)!=43 || InpStopPollSeconds<2 ||
      InpStopPollSeconds>60 || InpStopHttpTimeoutMs<1000 ||
      InpStopHttpTimeoutMs>10000 || StringFind(InpStagingHttpsBase,"https://")!=0 ||
      StringFind(InpStagingHttpsBase,"gold-pulse-ai.onrender.com")>=0 ||
      StringFind(InpStagingHttpsBase,"qaffel.com")>=0 ||
      StringFind(InpStagingHttpsBase,"nabdtrading.com")>=0)
     {
      Print("NABD phase12: DEMO-only explicit arm, independent token and isolated HTTPS staging required");
      return INIT_PARAMETERS_INCORRECT;
     }
   // Deliberate fail-closed arming before any poll. No implementation of RESUME.
   P12SetPause();
   if(!P12PausePersisted())return INIT_FAILED;
   if(!EventSetTimer(InpStopPollSeconds))return INIT_FAILED;
   Print("NABD phase12 PAUSE ARMED (new entries blocked, open positions untouched).");
   return INIT_SUCCEEDED;
  }
void OnDeinit(const int reason){EventKillTimer(); /* PAUSE persists */ }
void OnTimer()
  {
   // Never clear PAUSE, including after network errors or reinitialization.
   P12SetPause();
   if(!P12DemoIdentity() || !P12PausePersisted())return;
   string response="";
   int status=P12Request("/api/worker/risk-stop/poll","{"+P12Identity()+"}",response);
   if(status!=200)return;
   // Strictly consume one command with matching exact symbol and supported action.
   // The server already enforces account and token scope. All unknown data is ignored.
   string anchor="\"symbol\":"+P12Quote(StringFind(_Symbol,"BTCUSD")==0?"BTCUSD":"XAUUSD")+
                 ",\"action\":\"PAUSE_NEW_ENTRIES_ONLY\"";
   int found=StringFind(response,anchor);
   if(found<0)return;
   int start=StringFind(response,"\"requestId\":\"",0);
   if(start<0 || start>found)return;
   start+=StringLen("\"requestId\":\"");
   string requestId=StringSubstr(response,start,36);
   if(!P12Uuid(requestId))return;
   if(StringSubstr(response,start+36,1)!="\"")return;
   if(!P12PausePersisted())return;
   string ack="{"+P12Identity()+",\"requestId\":"+P12Quote(requestId)+
      ",\"symbol\":"+P12Quote(StringFind(_Symbol,"BTCUSD")==0?"BTCUSD":"XAUUSD")+
      ",\"persistedPaused\":true}";
   string reply="";
   P12Request("/api/worker/risk-stop/ack",ack,reply);
   // Reply is informational only: never grants trading permission.
  }
void OnTick()
  {
   // This EA NEVER sends any broker orders; open positions are managed
   // solely by the main trading EA. PAUSE remains set persistently.
   if(!P12PausePersisted())P12SetPause();
  }
