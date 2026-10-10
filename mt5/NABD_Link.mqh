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
   GlobalVariableSet(NABDKey("HB"),(double)TimeGMT());
  }
void NABDOnDeinit()
  {
   if(!InpEnableNABDLink || MQLInfoInteger(MQL_TESTER))return;
   GlobalVariableSet(NABDKey("HB"),0.0);GlobalVariableSet(NABDKey("L"),0.0);
  }
