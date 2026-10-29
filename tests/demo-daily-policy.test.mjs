import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('actual MQL demo policy sizes minimum despite exhausted daily allowance; real and legacy retain limits',()=>{
 const src=readFileSync(new URL('../mt5/XAUUSD_Technical_Bot_NABD_v3.mq5',import.meta.url),'utf8');
 const policy=src.slice(src.indexOf('bool DemoWebsiteNoDailyLimitsEnabled()\n'),src.indexOf('bool MarginIsAcceptable(const ENUM_ORDER_TYPE order_type,const double entry,const double volume)\n'));
 assert.ok(policy.includes('double CalculateVolume'));
 const dir=mkdtempSync(join(tmpdir(),'nabd-demo-risk-'));
 try{
 writeFileSync(join(dir,'risk.cpp'),`#include <cmath>
#include <algorithm>
#include <string>
#include <cassert>
using std::string;
using ENUM_ORDER_TYPE=int;
const int ACCOUNT_TRADE_MODE=1,ACCOUNT_TRADE_MODE_DEMO=2,ACCOUNT_EQUITY=3;
const int SYMBOL_VOLUME_MIN=1,SYMBOL_VOLUME_MAX=2,SYMBOL_VOLUME_STEP=3;
bool InpDemoWebsiteNoDailyLimits=true,InpEnableNABDLink=true,InpNABDDemoRecommendations=true,InpNABDWebsiteRecommendations=true,InpNABDAllowRemoteControl=true,InpDemoBrokerMinimumLot=true;
double InpRiskPercent=.5,InpMaxDailyLossPercent=2,equity=145.48,net=-20;
int mode=2; bool just=true; string g_symbol="XAUUSD.m";
double MathMax(double a,double b){return std::max(a,b);} double MathMin(double a,double b){return std::min(a,b);} double MathAbs(double a){return std::abs(a);} double MathFloor(double a){return std::floor(a);}
int AccountInfoInteger(int){return mode;} double AccountInfoDouble(int){return equity;} bool IsJustMarketsAccount(){return just;} double GetTodayNet(){return net;}
double SymbolInfoDouble(string,int key){return key==SYMBOL_VOLUME_MAX?100:.01;}
bool OrderCalcProfit(int,string,double v,double e,double s,double &loss){loss=-(std::abs(e-s)*100*v);return true;}
int VolumeDigits(double){return 2;} double NormalizeDouble(double a,int){return std::round(a*100)/100;}
${policy}
int main(){
 assert(DemoWebsiteNoDailyLimitsEnabled());
 assert(std::abs(CalculateVolume(0,4026.33,4034.95)-.01)<1e-9);
 InpDemoWebsiteNoDailyLimits=false;assert(CalculateVolume(0,4026.33,4034.95)==0);
 InpDemoWebsiteNoDailyLimits=true;mode=0;assert(!DemoWebsiteNoDailyLimitsEnabled());assert(CalculateVolume(0,4026.33,4034.95)==0);
 mode=2;InpNABDWebsiteRecommendations=false;assert(!DemoWebsiteNoDailyLimitsEnabled());assert(CalculateVolume(0,4026.33,4034.95)==0);
 InpNABDWebsiteRecommendations=true;equity=10000;net=0;assert(std::abs(CalculateVolume(0,4000,4008)-.06)<1e-9);
}`);
 execFileSync('g++',['-std=c++17','-Wall','-Werror',join(dir,'risk.cpp'),'-o',join(dir,'risk')]);
 execFileSync(join(dir,'risk'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
