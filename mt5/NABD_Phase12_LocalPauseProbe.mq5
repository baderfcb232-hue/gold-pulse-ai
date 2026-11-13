// NABD Phase 12 local pause probe — JustMarkets DEMO only.
// No WebRequest, no passwords, no orders, no remote RESUME.
// Arms the same durable account+symbol terminal flag checked by the patched
// NABD GOLD / BTC FUSION Demo EAs. DO NOT ATTACH TO REAL ACCOUNTS.
#property strict
#property version "1.00"
#property description "NABD Phase 12 LOCAL Demo PAUSE diagnostic — no orders"

input bool InpArmPersistentDemoPause = false;  // Explicit deliberate arm only

uint Phase12Hash(const string text)
  {
   uint hash=2166136261;
   for(int i=0;i<StringLen(text);i++)
      hash=(hash^(uint)StringGetCharacter(text,i))*16777619;
   return hash;
  }
string Phase12Key()
  {
   return StringFormat("NB_P12_%I64d_%u",AccountInfoInteger(ACCOUNT_LOGIN),Phase12Hash(_Symbol));
  }
bool IsExpectedSymbol()
  {
   string upper=_Symbol;
   StringToUpper(upper);
   if(StringFind(upper,"XAUUSD")==0)
      return StringLen(upper)==6 || StringFind("._#",StringSubstr(upper,6,1))>=0;
   if(StringFind(upper,"BTCUSD")==0)
      return StringLen(upper)==6 || StringFind("._#",StringSubstr(upper,6,1))>=0;
   return false;
  }
bool IsJustMarketsDemo()
  {
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)return false;
   string server=AccountInfoString(ACCOUNT_SERVER);
   string company=AccountInfoString(ACCOUNT_COMPANY);
   StringToLower(server);
   StringToLower(company);
   return AccountInfoInteger(ACCOUNT_LOGIN)>0 &&
      (StringFind(server,"justmarkets")>=0 || StringFind(company,"justmarkets")>=0);
  }
bool PersistPause()
  {
   const string key=Phase12Key();
   if(GlobalVariableSet(key,1.0)==0)
     {
      Print("NABD phase12 pause could not be persisted; error=",GetLastError());
      return false;
     }
   GlobalVariablesFlush();
   return GlobalVariableCheck(key) && GlobalVariableGet(key)>0.5;
  }
int OnInit()
  {
   if(!InpArmPersistentDemoPause || !IsJustMarketsDemo() || !IsExpectedSymbol())
     {
      Print("NABD LOCAL PROBE REFUSED: must explicitly arm on JustMarkets DEMO XAUUSD/BTCUSD only.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(!PersistPause())return INIT_FAILED;
   if(!EventSetTimer(5))return INIT_FAILED;
   Print("NABD LOCAL PHASE12 PAUSE ACTIVE: ",Phase12Key(),
         " — blocks NEW entries only in patched NABD EA; existing positions not closed.");
   return INIT_SUCCEEDED;
  }
void OnTimer()
  {
   // Reassert STOP while probe is attached. Removing this EA never clears flag.
   if(!IsJustMarketsDemo() || !IsExpectedSymbol())return;
   if(!PersistPause())Print("NABD Phase12 FAIL-CLOSED: cannot verify pause persistence");
  }
void OnDeinit(const int reason)
  {
   EventKillTimer();
   // Intentionally NO GlobalVariableDel here — stop survives MT5 restart.
  }
void OnTick()
  {
   // This probe NEVER places any trade and NEVER manipulates open positions.
  }
