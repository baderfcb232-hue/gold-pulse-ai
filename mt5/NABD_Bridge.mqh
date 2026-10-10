// Dashboard adapter for the existing JustMarkets EA. No new entries are sent by the site.
// Network access is opt-in. All account details remain behind the operator login.
bool g_nb_warned=false;
ulong g_nb_last_send=0;
datetime g_nb_calendar_time=0;
string g_nb_calendar="{\"status\":\"unavailable\",\"events\":[]}";
uint NABDHash(const string s)
  { uint h=2166136261; for(int i=0;i<StringLen(s);i++) h=(h^(uint)StringGetCharacter(s,i))*16777619; return h; }
string NABDKey(const string suffix)
  { return StringFormat("NB_%I64d_%I64d_%u_%s",AccountInfoInteger(ACCOUNT_LOGIN),InpMagicNumber,NABDHash(g_symbol),suffix); }
bool NABDRemotePaused()
  { return NBMainFresh() && NBMainValue("PS")>0.5; }
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
   int code=WebRequest(method,NBUrl(path),headers,1200,data,result,result_headers);
   response=CharArrayToString(result,0,WHOLE_ARRAY,CP_UTF8);
   if(code==-1) PrintFormat("NABD link failed. Error=%d. Check allowed WebRequest URLs.",GetLastError());
   return code;
  }
string NBCandles(const ENUM_TIMEFRAMES tf,const long offset)
  {
   MqlRates bars[];ArraySetAsSeries(bars,false);
   int n=CopyRates(g_symbol,tf,1,320,bars);
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
   if(n<0){g_nb_calendar="{\"status\":\"unavailable\",\"updated_at\":"+(string)now+",\"events\":[]}";return;}
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
   g_nb_calendar="{\"status\":"+NBQ(complete?"ok":"unavailable")+",\"updated_at\":"+(string)now+",\"events\":"+json+"]}";
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
void NBAcknowledge(const long id,const string status,const string message)
  {
   string response;
   NBRequest("POST","/api/bridge/result","{\"id\":"+(string)id+",\"status\":"+NBQ(status)+",\"message\":"+NBQ(message)+"}",response);
  }
void NBProcessCommand()
  {
   string response;
   if(NBRequest("GET","/api/bridge/next","",response)!=200 || StringLen(response)==0)return;
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
void NABDOnTimer()
  {
   if(!InpEnableNABDLink || MQLInfoInteger(MQL_TESTER))return;
   if(StringLen(InpNABDToken)<32 || StringFind(InpNABDUrl,"https://")!=0)
     {if(!g_nb_warned){Print("NABD requires an HTTPS URL and a 32+ character ingest token.");g_nb_warned=true;}return;}
   ulong now=GetTickCount64();
   if(g_nb_last_send>0 && now-g_nb_last_send<(ulong)MathMax(3,InpNABDRefreshSeconds)*1000)return;
   g_nb_last_send=now;
   MqlTick tick;if(!SymbolInfoTick(g_symbol,tick) || tick.bid<=0 || tick.ask<tick.bid)return;
   long offset=NBOffset();NBUpdateCalendar(offset);
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
     ",\"spec\":"+spec+",\"candles\":{\"M5\":"+NBCandles(PERIOD_M5,offset)+",\"M15\":"+NBCandles(PERIOD_M15,offset)+
     ",\"H1\":"+NBCandles(PERIOD_H1,offset)+",\"H4\":"+NBCandles(PERIOD_H4,offset)+"},\"calendar\":"+g_nb_calendar+
     ",\"execution\":{\"main_connected\":"+NBB(NBMainFresh())+",\"enabled\":"+NBB(TradingExecutionEnabled())+",\"remote_control\":"+NBB(InpNABDAllowRemoteControl && InpNABDSendAccount && NBMainFresh() && NBMainValue("R")>0.5)+
     ",\"demo\":"+NBB(AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO)+",\"paused\":"+NBB(NABDRemotePaused())+
     ",\"managed_magic\":"+NBQ((string)InpMagicNumber)+",\"small_profit_target\":"+NBD(NBMainValue("TP"),2)+
     ",\"max_daily_loss_percent\":"+NBD(NBMainValue("DL"),2)+",\"risk_percent\":"+NBD(NBMainValue("RP"),2)+
     ",\"news_filter\":"+NBB(NBMainValue("NF")>0.5)+"},\"ea\":"+NBEA(offset);
   if(InpNABDSendAccount)
      payload+=",\"account\":{\"currency\":"+NBQ(AccountInfoString(ACCOUNT_CURRENCY))+
        ",\"balance\":"+NBD(AccountInfoDouble(ACCOUNT_BALANCE),2)+",\"equity\":"+NBD(AccountInfoDouble(ACCOUNT_EQUITY),2)+
        ",\"free_margin\":"+NBD(AccountInfoDouble(ACCOUNT_MARGIN_FREE),2)+",\"floating\":"+NBD(AccountInfoDouble(ACCOUNT_PROFIT),2)+
        "},\"positions\":"+NBPositions(offset)+",\"deals\":"+NBDeals(offset);
   payload+="}";
   string response;int code=NBRequest("POST","/api/mt5",payload,response);
   if(code!=200){PrintFormat("NABD update rejected. HTTP=%d",code);return;}
   if(InpNABDAllowRemoteControl && InpNABDSendAccount)NBProcessCommand();
  }
