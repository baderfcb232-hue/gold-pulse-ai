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
   return MathAbs((direction>0?ask:bid)-entry)<=MathAbs(entry-sl)*0.15;
  }
// END WEBSITE_PLAN_GUARD
void NABDWebsiteBlocked(const double id,const string reason,const int code,const uint retcode=0)
  {
   // Publish all rejection details BEFORE the result id so the bridge never
   // associates an earlier order's MT5 retcode with a later recommendation.
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
   GlobalVariableSet(NABDKey("WRC"),0.0);GlobalVariableSet(NABDKey("WRT"),0.0);
   if(!TradingExecutionEnabled()){NABDWebsiteBlocked(id,"trading execution switch is off",101);return;}
   if(!ExecutionPermissionsAvailable()){NABDWebsiteBlocked(id,"terminal/account trade permissions unavailable",102);return;}
   if(!InpNABDAllowRemoteControl || NABDRemotePaused())
     {NABDWebsiteBlocked(id,"website remote control disabled or paused",103);return;}
   if(IsEmergencyStopActive()){NABDWebsiteBlocked(id,"emergency stop active",104);return;}
   if(HasOwnPosition() || HasOwnPendingOrder() || HasForeignNettingExposure())
     {NABDWebsiteBlocked(id,"existing position/order or foreign netting exposure",105);return;}
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
   signal.reason="NABD website gold recommendation";
   g_last_entry_bar=iTime(g_symbol,PERIOD_M5,0);
   bool accepted=PlaceSignal(signal);
   if(!accepted)
     {
      NABDWebsiteBlocked(id,"PlaceSignal declined or broker returned a rejection",
        g_website_attempt_code>0?g_website_attempt_code:115,g_website_attempt_retcode);
      return;
     }
   GlobalVariableSet(NABDKey("WRC"),0.0);
   GlobalVariableSet(NABDKey("WRT"),(double)g_website_attempt_retcode);
   GlobalVariableSet(NABDKey("WR"),2.0);GlobalVariableSet(NABDKey("WI"),id);GlobalVariablesFlush();
   LogEvent("WEBSITE_SUBMITTED",StringFormat("approval=%.0f,retcode=%u; verify deal in History",
     id,g_website_attempt_retcode));
  }
void NABDOnTimer()
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
