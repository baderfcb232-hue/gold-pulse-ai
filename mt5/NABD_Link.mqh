// Terminal coordination only; no network I/O in the trading EA.
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
void NABDOnTimer()
  {
   if(!InpEnableNABDLink || MQLInfoInteger(MQL_TESTER))return;
   GlobalVariableSet(NABDKey("L"),TradingExecutionEnabled()?1.0:0.0);
   GlobalVariableSet(NABDKey("R"),InpNABDAllowRemoteControl?1.0:0.0);
   GlobalVariableSet(NABDKey("TP"),InpUseSmallProfit?InpBasketProfitTarget:0.0);
   GlobalVariableSet(NABDKey("DL"),InpMaxDailyLossPercent);
   GlobalVariableSet(NABDKey("RP"),InpRiskPercent);
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
   GlobalVariableSet(NABDKey("HB"),(double)TimeGMT());
   NABDProcessDemoApproval();
  }
void NABDOnDeinit()
  {
   if(!InpEnableNABDLink || MQLInfoInteger(MQL_TESTER))return;
   GlobalVariableSet(NABDKey("HB"),0.0);GlobalVariableSet(NABDKey("L"),0.0);
  }
