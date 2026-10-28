import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import test from 'node:test';
import {prepareResearchPostgresInputs,RESEARCH_NODE_IMAGE,RESEARCH_POSTGRES_IMAGE,runResearchPostgres17} from './run-research-postgres17.mjs';
import {researchFixtureIdentity} from './lib/research-fixture-identity.mjs';
import {runResearchNativeJourney} from './run-research-native-journey.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const pgId=`sha256:${'a'.repeat(64)}`,nodeId=`sha256:${'b'.repeat(64)}`;
const packMarkers=['EMPLOYER_QUESTION_PACK_NATIVE_JOURNEY_OK','PAID_PACK_ROUTE_DELIVERY_OBLIGATION_RECEIPT','PAID_PACK_PREPARE_PACKET_RECEIPT'];
const sourceMarkers=['EMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK','PAID_PACK_ROUTE_DELIVERY_OBLIGATION_RECEIPT','PAID_PACK_PREPARE_PACKET_RECEIPT','OWNER_NOTICE_ACCEPTED_RETRY_RECEIPT','PAID_PACK_SOURCE_READY_PROPOSAL_RECEIPT','EMPLOYER_QUESTION_SOURCE_NATIVE_JOURNEY_OK'];
function fixture({missingSourceMarker,missingSourceRunnerMarker,sourceOrderReversed,fail,drift,missingMarker,missingAggregate,missingOwnerMarker,missingEmployerRunnerMarker,missingPackMarker,missingPackRunnerMarker,ambiguousCreate,cleanupFailure}={}) {
  const calls=[],states=new Map(),writes=[],prepared={commit:'c'.repeat(40),schemaVersion:'202610280106',workspace:'/fixture/source',dependencies:'/fixture/dependencies',directory:'/fixture/evidence',sql:'-- actual schema input placeholder',migrationCount:111,inputHashes:[],sourceArchiveSha256:'d'.repeat(64)};
  let counter=0;
  const execute=(command,args,options)=>{
    calls.push({command,args,options});assert.equal(command,'docker');assert.deepEqual(args.slice(0,2),['--host','unix:///var/run/docker.sock']);
    const op=args[2],at=name=>args[args.indexOf(name)+1];
    if(op==='image') {const pg=args[4]===RESEARCH_POSTGRES_IMAGE;return JSON.stringify([{Id:pg?pgId:nodeId,Os:'linux',Architecture:'amd64',RepoDigests:[(pg?RESEARCH_POSTGRES_IMAGE:RESEARCH_NODE_IMAGE).replace(pg?':17-trixie':':22-bookworm-slim','')],Config:{Env:pg?['PG_MAJOR=17','PG_VERSION=17.11-1']:['NODE_VERSION=22.22.0'],Volumes:pg?{'/var/lib/postgresql/data':{}}:{}}}]);}
    if(op==='create') {
      const name=at('--name'),pg=name.includes('-pg-'),labels={};
      args.forEach((value,index)=>{if(value==='--label'){const text=args[index+1],eq=text.indexOf('=');labels[text.slice(0,eq)]=text.slice(eq+1);}});
      const mounts=[];args.forEach((value,index)=>{if(value==='--mount'){const parts=Object.fromEntries(args[index+1].split(',').filter(v=>v.includes('=')).map(v=>v.split('=')));mounts.push({Type:parts.type,Source:parts.src,Destination:parts.dst,RW:false});}if(value==='--tmpfs')mounts.push({Type:'tmpfs'});});
      states.set(name,{Id:hash(name),Name:`/${name}`,Image:pg?pgId:nodeId,Config:{User:at('--user'),Labels:labels},HostConfig:{NetworkMode:at('--network'),ReadonlyRootfs:args.includes('--read-only'),Privileged:false,PortBindings:{},PublishAllPorts:false,Memory:Number(at('--memory').replace('m',''))*1024*1024,PidsLimit:Number(at('--pids-limit')),NanoCpus:Number(at('--cpus'))*1e9,CapDrop:['ALL'],SecurityOpt:['no-new-privileges']},Mounts:mounts,State:{Running:false,ExitCode:0,OOMKilled:false}});
      if(ambiguousCreate===(pg?'postgres':'node'))throw new Error('lost create response');
      return hash(name);
    }
    if(op==='inspect'){const state=structuredClone(states.get(args[3]));if(drift)drift(state);return JSON.stringify([state]);}
    if(op==='ps'){const name=at('--filter').slice(7,-1);return states.has(name)?states.get(name).Id:'';}
    if(op==='rm'){if(cleanupFailure)throw new Error('cleanup unavailable');states.delete(args.at(-1));return '';}
    if(op==='start') {
      if(args.includes('--attach')){
        const invocation=calls.find(call=>call.args[2]==='create'&&call.args[call.args.indexOf('--name')+1]===args.at(-1));
        const scenario=invocation.args.at(-1);
        if(fail==='journey'||fail==='paid-journey'&&scenario==='PAID_SEARCH'||fail==='employer-journey'&&scenario==='EMPLOYER_RULE'||fail==='pack-journey'&&scenario==='PACK_PACKET'||fail==='source-journey'&&scenario==='PACK_SOURCE')throw new Error('route assertion failed');
        if(missingMarker)return 'schema only\n';
        if(scenario==='PACK_SOURCE')return (sourceOrderReversed?[...sourceMarkers].reverse():sourceMarkers).filter(marker=>marker!==missingSourceMarker).map(marker=>`${marker} {"hostedProof":false}\n`).join('')
          +(missingSourceRunnerMarker?'':'PACK_SOURCE_ROUTE_DATABASE_JOURNEY_OK: fictional boundary; real routes\n');
        if(scenario==='PACK_PACKET')return packMarkers.filter(marker=>marker!==missingPackMarker).map(marker=>`${marker} {"hostedProof":false}\n`).join('')
          +(missingPackRunnerMarker?'':'PACK_PACKET_ROUTE_DATABASE_JOURNEY_OK: fictional boundary; real routes\n');
        if(scenario==='EMPLOYER_RULE')return (missingOwnerMarker?'':'EMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK\n')+(missingEmployerRunnerMarker?'':'EMPLOYER_RULE_ROUTE_DATABASE_JOURNEY_OK: fictional boundary; real routes\n');
        return scenario==='PAID_SEARCH'?'PAID_SEARCH_ROUTE_DATABASE_JOURNEY_OK: fictional boundary; real routes\n'
          :'RESEARCH_ROUTE_DATABASE_JOURNEY_OK: fictional boundary; real routes\n'+(scenario==='LIMITED'&&!missingAggregate?'RESEARCH_CLARIFICATION_NOTIFICATION_JOURNEYS_OK\n':'');
      }
      return '';
    }
    if(op==='exec') {
      if(fail&&args.some(value=>value.endsWith(`/${fail}`)))throw new Error('fixture setup failed');
      if(args.includes('/usr/lib/postgresql/17/bin/psql'))return ' RESEARCH_SCHEMA_READY \n';
    }
    return '';
  };
  const run=(args=[],environment={},platform='linux')=>runResearchPostgres17(args,{execute,environment,platform,uuid:()=>`11111111-2222-4333-8444-${String(++counter).padStart(12,'0')}`,inputs:()=>prepared,write:(...args)=>writes.push(args)});
  return {calls,run,states,writes};
}
test('runs six scenarios in separate owned networkless namespaces and cleans all twelve containers',()=>{
  const f=fixture(),receipt=f.run([],{PATH:'/bin',AWS_SECRET_ACCESS_KEY:'fictional',STRIPE_SECRET_KEY:'fictional'});
  assert.deepEqual(receipt.results.map(value=>value.scenario),['QUALIFIED','LIMITED','PAID_SEARCH','EMPLOYER_RULE','PACK_PACKET','PACK_SOURCE']);assert.equal(receipt.hostedProof,false);assert.equal(receipt.providerCalls,0);assert.equal(f.states.size,0);
  const created=f.calls.filter(call=>call.args[2]==='create');assert.equal(created.length,12);
  const servers=created.filter(call=>call.args.includes('none')),nodes=created.filter(call=>call.args.some(value=>value.startsWith('container:')));
  assert.equal(servers.length,6);assert.equal(nodes.length,6);assert.equal(new Set(nodes.map(node=>node.args[node.args.indexOf('--network')+1])).size,6);
  for(const {args}of nodes){assert(args.includes('AP_RESEARCH_TEST_MODE=CONTAINER_PG17'));assert(args.includes('AP_RESEARCH_TEST_PORT=5432'));const mounts=args.filter(value=>value.startsWith('type=bind'));assert(mounts.every(value=>value.endsWith(',readonly')));assert(!mounts.some(value=>value.includes('.env')||value.includes('docker.sock')));}
  assert(f.calls.every(call=>call.options.env.AWS_SECRET_ACCESS_KEY===undefined&&call.options.env.STRIPE_SECRET_KEY===undefined));
  assert.equal(f.calls.filter(call=>call.args.includes('/usr/lib/postgresql/17/bin/psql')).length,6);
  const attached=f.calls.filter(call=>call.args.includes('--attach'));assert.deepEqual(attached.map(call=>call.options.timeout),[330000,330000,330000,330000,330000,510000]);
  assert.equal(f.writes.length,6);assert(receipt.results.every(value=>value.teardownVerified));
});
test('paid-search failure fails the aggregate and tears down all three isolated scenarios',()=>{
  const f=fixture({fail:'paid-journey'});assert.throws(()=>f.run(),/route assertion failed/u);assert.equal(f.states.size,0);
  assert.equal(f.calls.filter(call=>call.args[2]==='create').length,6);assert(f.writes.some(([path])=>path.replaceAll('\\','/').endsWith('/paid_search-failure.log')));
});
test('employer-rule failure fails the aggregate after all four isolated scenarios and cleans its pair',()=>{
  const f=fixture({fail:'employer-journey'});assert.throws(()=>f.run(),/route assertion failed/u);assert.equal(f.states.size,0);
  assert.equal(f.calls.filter(call=>call.args[2]==='create').length,8);assert(f.writes.some(([path])=>path.replaceAll('\\','/').endsWith('/employer_rule-failure.log')));
});
for(const [option,reason]of [['missingOwnerMarker','EMPLOYER_RULE_OWNER_MARKER'],['missingEmployerRunnerMarker','RESEARCH_ROUTE_MARKER']])test(`employer-rule requires ${option} independently and still cleans all owned containers`,()=>{
  const f=fixture({[option]:true});assert.throws(()=>f.run(),new RegExp(reason,'u'));assert.equal(f.states.size,0);
  assert.equal(f.calls.filter(call=>call.args[2]==='create').length,8);
});
test('pack-packet failure fails the aggregate after all five isolated scenarios and cleans its pair',()=>{
  const f=fixture({fail:'pack-journey'});assert.throws(()=>f.run(),/route assertion failed/u);assert.equal(f.states.size,0);
  assert.equal(f.calls.filter(call=>call.args[2]==='create').length,10);assert(f.writes.some(([path])=>path.replaceAll('\\','/').endsWith('/pack_packet-failure.log')));
});
for(const missingPackMarker of packMarkers)test(`pack-packet requires ${missingPackMarker} despite the remaining stage and runner markers`,()=>{
  const f=fixture({missingPackMarker});assert.throws(()=>f.run(),new RegExp(`PACK_PACKET_STAGE_MARKER:${missingPackMarker}`,'u'));assert.equal(f.states.size,0);
  assert.equal(f.calls.filter(call=>call.args[2]==='create').length,10);
});
test('pack-packet stage receipts without its runner marker cannot pass the aggregate',()=>{
  const f=fixture({missingPackRunnerMarker:true});assert.throws(()=>f.run(),/RESEARCH_ROUTE_MARKER/u);assert.equal(f.states.size,0);
  assert.equal(f.calls.filter(call=>call.args[2]==='create').length,10);
});
test('LIMITED requires the full three-stage completion marker',()=>{
  const f=fixture({missingAggregate:true});assert.throws(()=>f.run(),/RESEARCH_AGGREGATE_MARKER/u);assert.equal(f.states.size,0);
});
for(const fail of ['initdb','pg_ctl','psql','journey'])test(`failure at ${fail} cleans exactly the containers already created`,()=>{const f=fixture({fail});assert.throws(()=>f.run());assert.equal(f.states.size,0);});
for(const ambiguousCreate of ['postgres','node'])test(`lost ${ambiguousCreate} creation response is reconciled and cleaned`,()=>{const f=fixture({ambiguousCreate});assert.throws(()=>f.run(),/lost create/u);assert.equal(f.states.size,0);});
test('schema success without route marker is failure',()=>{const f=fixture({missingMarker:true});assert.throws(()=>f.run(),/RESEARCH_ROUTE_MARKER/u);assert.equal(f.states.size,0);});
for(const drift of [
 state=>{if(state.Name.includes('-pg-'))state.HostConfig.NetworkMode='host';},
 state=>{state.HostConfig.PortBindings={'5432/tcp':[{}]};},
  state=>{state.HostConfig.ReadonlyRootfs=false;},
  state=>{state.HostConfig.Memory=0;},
  state=>{state.HostConfig.PublishAllPorts=true;},
  state=>{if(state.Name.includes('-node-'))state.HostConfig.NetworkMode=`container:${'f'.repeat(64)}`;},
 state=>{if(state.Name.includes('-node-'))state.Mounts[0]={Type:'bind',Source:'/unrelated',Destination:'/workspace',RW:false};},
 state=>{if(state.Name.includes('-node-'))state.Mounts.find(value=>value.Type==='bind').RW=true;},
 state=>{if(state.Name.includes('-node-'))state.State.OOMKilled=true;},
])test('rejects isolation or completion drift and removes only owned containers',()=>{const f=fixture({drift});assert.throws(()=>f.run());assert.equal(f.states.size,0);});
test('foreign label prevents deletion',()=>{const f=fixture({drift:state=>{state.Config.Labels['io.applypack.fixture-run']='foreign';}});assert.throws(()=>f.run(),/RESEARCH_CLEANUP_FAILED/u);assert.equal(f.states.size,1);assert(!f.calls.some(call=>call.args[2]==='rm'));});
test('failed cleanup cannot yield PASS',()=>{const f=fixture({cleanupFailure:true});assert.throws(()=>f.run(),/RESEARCH_CLEANUP_FAILED/u);});
for(const key of ['DOCKER_HOST','PGHOST','PGOPTIONS','DATABASE_URL','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','AP_RESEARCH_TEST_PORT'])test(`rejects inherited ${key} before any process`,()=>{const f=fixture();assert.throws(()=>f.run([],{[key]:'fictional'}),/RESEARCH_EXTERNAL_ENVIRONMENT/u);assert.equal(f.calls.length,0);});
test('no arbitrary options or unsupported local platform',()=>{const f=fixture();assert.throws(()=>f.run(['--skip']));assert.throws(()=>f.run([],{},'win32'));assert.equal(f.calls.length,0);});
const marker='a'.repeat(32);
function nativeJourney(scenario,responses=[{status:0,stdout:'EMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK\n'}],nativeWindows=false) {
 const calls=[],logs=[],output=[],errors=[];
 const status=runResearchNativeJourney([scenario],{environment:nativeWindows ? {AP_RESEARCH_TEST_MODE:'NATIVE_WINDOWS',AP_RESEARCH_TEST_PORT:'5433',AP_RESEARCH_TEST_MARKER:marker,AP_RESEARCH_TEST_PSQL:'C:/fictional/psql.exe'} : {AP_RESEARCH_TEST_MODE:'CONTAINER_PG17',AP_RESEARCH_TEST_PORT:'5432',AP_RESEARCH_TEST_MARKER:marker},platform:nativeWindows?'win32':'linux',
  spawn:(...args)=>{calls.push(args);return responses.shift()??{status:0};},log:value=>logs.push(value),write:value=>output.push(value),writeError:value=>errors.push(value)});
 return {status,calls,logs,output,errors};
}
test('employer-rule runner invokes exactly its own test stage and requires actual owner completion before its marker',()=>{
 const f=nativeJourney('EMPLOYER_RULE');assert.equal(f.status,0);assert.equal(f.calls.length,1);
 const [,args,options]=f.calls[0];assert(args.includes('vitest.research-container.config.mjs'));assert.equal(options.env.AP_RESEARCH_TEST_CASE,'EMPLOYER_RULE');assert.equal(options.env.AP_RESEARCH_JOURNEY_STAGE,'EMPLOYER_RULE');
 assert.equal(options.timeout,300000);assert.deepEqual(options.stdio,['ignore','pipe','pipe']);assert.equal(options.maxBuffer,16*1024*1024);
 assert.equal(f.logs.length,1);assert(f.logs[0].startsWith('EMPLOYER_RULE_ROUTE_DATABASE_JOURNEY_OK:'));assert.deepEqual(f.output,['EMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK\n']);
 assert(!f.calls.some(([, , value])=>value.env.AP_RESEARCH_JOURNEY_STAGE==='PAID_SEARCH'));
});
test('employer-rule owner completion accepts the actual receipt payload and harmless terminal styling',()=>{
 const output='\u001b[32mEMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK {"realProviderCalls":0}\u001b[39m\n';
 const f=nativeJourney('EMPLOYER_RULE',[{status:0,stdout:output}]);assert.equal(f.status,0);assert.deepEqual(f.output,[output]);assert.equal(f.logs.length,1);
});
for(const response of [{status:0,stdout:'PAID_SEARCH_ROUTE_DELIVERY_RECEIPT\nRESEARCH_SCHEMA_READY\n'},
 {status:0,stdout:'EMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK_extra\n'}, {status:1,stdout:'EMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK\n'},
 {status:null,error:new Error('child timeout'),stdout:'EMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK\n'}])test('employer-rule runner rejects missing owner completion, failed exit or timeout without emitting success',()=>{
 const f=nativeJourney('EMPLOYER_RULE',[response]);assert.equal(f.status,1);assert.equal(f.calls.length,1);assert.deepEqual(f.logs,[]);
});
test('pack-packet runs its one combined test on the fresh database without separately repeating search or owner',()=>{
 const output=packMarkers.map(marker=>`${marker} {"realProviderCalls":0}\n`).join('');
 const f=nativeJourney('PACK_PACKET',[{status:0,stdout:output}]);assert.equal(f.status,0);assert.equal(f.calls.length,1);
 const [,args,options]=f.calls[0];assert(args.includes('vitest.research-container.config.mjs'));assert.equal(options.env.AP_RESEARCH_TEST_CASE,'PACK_PACKET');assert.equal(options.env.AP_RESEARCH_JOURNEY_STAGE,'PACK_PACKET');
 assert.equal(options.timeout,300000);assert.deepEqual(options.stdio,['ignore','pipe','pipe']);assert.equal(options.maxBuffer,16*1024*1024);
 assert.equal(f.logs.length,1);assert(f.logs[0].startsWith('PACK_PACKET_ROUTE_DATABASE_JOURNEY_OK:'));assert.deepEqual(f.output,[output]);
 assert(!f.calls.some(([, , value])=>['PAID_SEARCH','EMPLOYER_RULE'].includes(value.env.AP_RESEARCH_JOURNEY_STAGE)));
});
test('pack-packet accepts exact receipt lines with harmless terminal styling',()=>{
 const output=packMarkers.map(marker=>`\u001b[32m${marker} {"realProviderCalls":0}\u001b[39m\n`).join('');
 const f=nativeJourney('PACK_PACKET',[{status:0,stdout:output}]);assert.equal(f.status,0);assert.deepEqual(f.output,[output]);assert.equal(f.logs.length,1);
});
for(const missing of packMarkers)test(`pack-packet native runner rejects absent ${missing} even when parent and runner completion text is supplied`,()=>{
 const output=packMarkers.filter(marker=>marker!==missing).map(marker=>`${marker}\n`).join('')+'PACK_PACKET_ROUTE_DATABASE_JOURNEY_OK: untrusted child text\n';
 const f=nativeJourney('PACK_PACKET',[{status:0,stdout:output}]);assert.equal(f.status,1);assert.equal(f.calls.length,1);assert.deepEqual(f.logs,[]);
});
for(const output of [packMarkers.map(marker=>`${marker}_extra\n`).join(''),packMarkers.join('\n')+'\n'+packMarkers[1]+'\n'])test('pack-packet rejects suffixed or duplicate stage receipts',()=>{
 const f=nativeJourney('PACK_PACKET',[{status:0,stdout:output}]);assert.equal(f.status,1);assert.deepEqual(f.logs,[]);
});
for(const response of [{status:1,stdout:packMarkers.join('\n')+'\n'}, {status:null,error:new Error('child timeout'),stdout:packMarkers.join('\n')+'\n'}])test('pack-packet failed exit or timeout cannot emit success despite all receipts',()=>{
 const f=nativeJourney('PACK_PACKET',[response]);assert.equal(f.status,1);assert.equal(f.calls.length,1);assert.deepEqual(f.logs,[]);
});
for(const [scenario,stages]of [['QUALIFIED',['RESEARCH']],['LIMITED',['RESEARCH','CLARIFICATION','NOTIFICATION']],['PAID_SEARCH',['PAID_SEARCH']]])test(`original ${scenario} stage sequence and inherited output remain unchanged`,()=>{
 const f=nativeJourney(scenario,stages.map(()=>({status:0})));assert.equal(f.status,0);assert.deepEqual(f.calls.map(([, , options])=>options.env.AP_RESEARCH_JOURNEY_STAGE),stages);
 assert(f.calls.every(([, , options])=>options.stdio==='inherit'&&options.timeout===300000));
 assert.equal(f.logs.includes('RESEARCH_CLARIFICATION_NOTIFICATION_JOURNEYS_OK'),scenario==='LIMITED');
});
test('an original LIMITED stage failure still prevents later work and its aggregate marker',()=>{
 const f=nativeJourney('LIMITED',[{status:0},{status:1}]);assert.equal(f.status,1);assert.equal(f.calls.length,2);assert(!f.logs.includes('RESEARCH_CLARIFICATION_NOTIFICATION_JOURNEYS_OK'));
});
test('test identity preserves native mode and requires exact container loopback identity',()=>{
 assert.deepEqual(researchFixtureIdentity({AP_RESEARCH_TEST_PORT:'54321',AP_RESEARCH_TEST_MARKER:marker,AP_RESEARCH_TEST_PSQL:'C:/owned/psql.exe',PGOPTIONS:'-c statement_timeout=60000 -c lock_timeout=10000'},'win32'),{port:54321,marker,mode:'NATIVE_WINDOWS'});
 assert.deepEqual(researchFixtureIdentity({AP_RESEARCH_TEST_PORT:'5432',AP_RESEARCH_TEST_MARKER:marker,AP_RESEARCH_TEST_MODE:'CONTAINER_PG17'},'linux'),{port:5432,marker,mode:'CONTAINER_PG17'});
});
for(const changes of [{AP_RESEARCH_TEST_PORT:'5433'},{AP_RESEARCH_TEST_MARKER:'wrong'},{AP_RESEARCH_TEST_PSQL:'/bin/psql'},{AP_RESEARCH_TEST_MODE:'host'},{DATABASE_URL:'postgres://fictional'},{PGPASSWORD:'fictional'}])test('rejects forged container fixture identity',()=>{assert.throws(()=>researchFixtureIdentity({AP_RESEARCH_TEST_PORT:'5432',AP_RESEARCH_TEST_MARKER:marker,AP_RESEARCH_TEST_MODE:'CONTAINER_PG17',...changes},'linux'));});

test('source preparation archives only committed allowlisted bytes and excludes developer secrets/WIP',()=>{
 const base=resolve(tmpdir()),directory=mkdtempSync(join(base,'applypack-research-input-'));
 const files=['src/example.ts','package.json','package-lock.json','tsconfig.json','scripts/run-research-native-journey.mjs','scripts/lib/research-fixture-identity.mjs',
  'scripts/lib/archive-writer-completion.mjs','scripts/lib/aws-roles-anywhere.mjs','scripts/lib/database-recovery-protocol.mjs','vitest.research-container.config.mjs',
  'tests/integration/automatic-research-preparation.sql','tests/integration/retention-postgres17-bootstrap.sql','tests/integration/research-local-database.ts','tests/integration/research-local-postgres.ts','tests/integration/research-preparation-journey.test.ts',
  'tests/integration/material-clarification-route-journey.test.ts','tests/integration/material-clarification-confirmation.sql',
  'tests/integration/intake-notification-native-journey.test.ts','tests/integration/verified-intake-ownership.sql',
  'tests/integration/verified-intake-payment.sql','tests/integration/reviewed-source-fixture.sql',
  'tests/integration/verified-paid-search-native-journey.test.ts','tests/integration/verified-paid-search-setup.ts','tests/integration/paid-search-provider-fixture.ts',
  'tests/integration/employer-rule-owner-native-journey.test.ts','tests/integration/employer-question-source-fixture.ts',
  'tests/integration/verified-employer-rule-owner-setup.ts','tests/integration/verified-paid-pack-setup.ts',
  'tests/integration/verified-paid-pack-packet-setup.ts','tests/integration/employer-question-pack-native-journey.test.ts',
  'tests/integration/draft-provider-fixture.ts','tests/integration/verified-paid-pack-source-setup.ts',
  'tests/integration/employer-question-source-native-journey.test.ts','supabase/migrations/202610280106_fictional.sql'];
 try {
  for(const path of files){mkdirSync(dirname(join(directory,path)),{recursive:true});writeFileSync(join(directory,path),path.endsWith('.sql')?'select 1;\n':'committed bytes\n');}
  const git=args=>execFileSync('git',args,{cwd:directory,stdio:'pipe',timeout:30000});
  git(['init','--quiet']);git(['add','--',...files]);git(['-c','user.name=Fictional Test','-c','user.email=fixture@example.invalid','commit','--quiet','-m','fictional fixture']);
  writeFileSync(join(directory,'src/example.ts'),'uncommitted mutation\n');writeFileSync(join(directory,'.env.local'),'PRIVATE_SENTINEL');mkdirSync(join(directory,'node_modules'));
  const prepared=prepareResearchPostgresInputs({repositoryRoot:directory,environment:{PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT}});
  const extracted=readFileSync(join(prepared.workspace,'src/example.ts')),blob=git(['show','HEAD:src/example.ts']);
  assert(extracted.equals(blob),JSON.stringify({extractedHex:extracted.toString('hex'),blobHex:blob.toString('hex')}));assert(!extracted.toString('utf8').includes('uncommitted'));assert(!readdirSync(prepared.workspace).includes('.env.local'));
  assert.equal(prepared.migrationCount,1);assert.match(prepared.sql,/schema_migrations/u);assert(prepared.inputHashes.every(value=>/^[a-f0-9]{64}$/u.test(value.sha256)));
  assert.deepEqual(readdirSync(join(prepared.workspace,'node_modules')),[]);
  assert(!prepared.inputHashes.some(value=>value.path.startsWith('node_modules/')));
  for(const path of files.filter(value=>value.startsWith('tests/integration/')||value.startsWith('scripts/lib/'))){
   assert(prepared.inputHashes.some(value=>value.path===path),`required journey source absent: ${path}`);
   assert(readFileSync(join(prepared.workspace,path)).equals(git(['show',`HEAD:${path}`])),`required journey source differs: ${path}`);
  }
 }finally {
  const target=resolve(directory);assert(target.startsWith(base+sep)&&target.slice(base.length+1).startsWith('applypack-research-input-'));rmSync(target,{recursive:true,force:true});
 }
});

test('source-generation failure fails the sixth scenario and cleans its pair',()=>{
 const f=fixture({fail:'source-journey'});assert.throws(()=>f.run(),/route assertion failed/u);assert.equal(f.states.size,0);
 assert.equal(f.calls.filter(call=>call.args[2]==='create').length,12);assert(f.writes.some(([path])=>path.replaceAll('\\','/').endsWith('/pack_source-failure.log')));
});
for(const missingSourceMarker of sourceMarkers)test(`source aggregate requires ${missingSourceMarker} independently`,()=>{
 const f=fixture({missingSourceMarker});assert.throws(()=>f.run(),new RegExp(`PACK_SOURCE_STAGE_MARKER:${missingSourceMarker}`,'u'));assert.equal(f.states.size,0);
 assert.equal(f.calls.filter(call=>call.args[2]==='create').length,12);
});
test('source stage receipts without the runner marker cannot pass',()=>{const f=fixture({missingSourceRunnerMarker:true});assert.throws(()=>f.run(),/RESEARCH_ROUTE_MARKER/u);assert.equal(f.states.size,0);});
test('source aggregate rejects reversed stage order and cleans its database',()=>{const f=fixture({sourceOrderReversed:true});assert.throws(()=>f.run(),/PACK_SOURCE_STAGE_ORDER/u);assert.equal(f.states.size,0);});
test('source native runner invokes one combined stage with only its separate approved child ceiling',()=>{
 const output=sourceMarkers.map(marker=>`${marker} {"realProviderCalls":0}\n`).join('');
 const f=nativeJourney('PACK_SOURCE',[{status:0,stdout:output}]);assert.equal(f.status,0);assert.equal(f.calls.length,1);
 const [,args,options]=f.calls[0];assert(args.includes('vitest.research-container.config.mjs'));
 assert.equal(options.env.AP_RESEARCH_TEST_CASE,'PACK_SOURCE');assert.equal(options.env.AP_RESEARCH_JOURNEY_STAGE,'PACK_SOURCE');
 assert.equal(options.timeout,480000);assert.deepEqual(options.stdio,['ignore','pipe','pipe']);assert.equal(options.maxBuffer,16*1024*1024);
 assert.equal(f.logs.length,1);assert(f.logs[0].startsWith('PACK_SOURCE_ROUTE_DATABASE_JOURNEY_OK:'));assert.deepEqual(f.output,[output]);
});
for(const missing of sourceMarkers)test(`source native runner rejects absent ${missing} despite parent/runner text`,()=>{
 const output=sourceMarkers.filter(marker=>marker!==missing).join('\n')+'\nPACK_SOURCE_ROUTE_DATABASE_JOURNEY_OK: untrusted child text\n';
 const f=nativeJourney('PACK_SOURCE',[{status:0,stdout:output}]);assert.equal(f.status,1);assert.deepEqual(f.logs,[]);
});
for(const output of [[...sourceMarkers].reverse().join('\n'),sourceMarkers.map(marker=>marker+'_extra').join('\n'),sourceMarkers.join('\n')+'\n'+sourceMarkers[1]])test('source native runner rejects reordered, suffixed or repeated stage receipts',()=>{
 const f=nativeJourney('PACK_SOURCE',[{status:0,stdout:output}]);assert.equal(f.status,1);assert.deepEqual(f.logs,[]);
});
for(const response of [{status:1,stdout:sourceMarkers.join('\n')},{status:null,error:new Error('child timeout'),stdout:sourceMarkers.join('\n')}])test('source native failure or timeout cannot be redeemed by complete markers',()=>{
 const f=nativeJourney('PACK_SOURCE',[response]);assert.equal(f.status,1);assert.deepEqual(f.logs,[]);
});

const localDocMarkers=[...sourceMarkers.slice(0,3),'PAID_PACK_SOURCE_READY_PROPOSAL_RECEIPT','OWNER_NOTICE_SUPPRESSED_RECEIPT','PAID_PACK_OWNER_LOCAL_DOCUMENTS_RECEIPT','EMPLOYER_QUESTION_LOCAL_DOC_NATIVE_JOURNEY_OK'];
test('local document journey rejects container mode before spawning any process',()=>{
 const calls=[];
 assert.throws(()=>runResearchNativeJourney(['PACK_LOCAL_DOC'],{environment:{AP_RESEARCH_TEST_MODE:'CONTAINER_PG17',AP_RESEARCH_TEST_PORT:'5432',AP_RESEARCH_TEST_MARKER:marker},platform:'linux',spawn:(...args)=>{calls.push(args);return{status:0};}}),/explicit native renderer/u);
 assert.deepEqual(calls,[]);
});
test('local document native runner invokes one honest local stage with its separate ceiling',()=>{
 const output=localDocMarkers.map(marker=>`${marker} {"hostedProof":false}\n`).join('');
 const f=nativeJourney('PACK_LOCAL_DOC',[{status:0,stdout:output}],true);assert.equal(f.status,0);assert.equal(f.calls.length,1);
 const [,args,options]=f.calls[0];assert(args.includes('vitest.research-native.config.mts'));assert(!args.includes('vitest.research-container.config.mjs'));
 assert.equal(options.env.AP_RESEARCH_TEST_CASE,'PACK_LOCAL_DOC');assert.equal(options.env.AP_RESEARCH_JOURNEY_STAGE,'PACK_LOCAL_DOC');
 assert.equal(options.timeout,660000);assert.deepEqual(options.stdio,['ignore','pipe','pipe']);assert.equal(options.maxBuffer,16*1024*1024);
 assert.equal(f.logs.length,1);assert(f.logs[0].startsWith('PACK_LOCAL_DOC_ROUTE_DATABASE_JOURNEY_OK:'));assert.deepEqual(f.output,[output]);
});
for(const missing of localDocMarkers)test(`local document runner rejects missing ${missing} despite parent/runner text`,()=>{
 const output=localDocMarkers.filter(marker=>marker!==missing).join('\n')+'\nPACK_LOCAL_DOC_ROUTE_DATABASE_JOURNEY_OK: untrusted child text\n';
 const f=nativeJourney('PACK_LOCAL_DOC',[{status:0,stdout:output}],true);assert.equal(f.status,1);assert.deepEqual(f.logs,[]);
});
for(const output of [[...localDocMarkers].reverse().join('\n'),localDocMarkers.map(marker=>marker+'_extra').join('\n'),localDocMarkers.join('\n')+'\n'+localDocMarkers[1]])test('local document runner rejects reordered, suffixed or repeated stage receipts',()=>{
 const f=nativeJourney('PACK_LOCAL_DOC',[{status:0,stdout:output}],true);assert.equal(f.status,1);assert.deepEqual(f.logs,[]);
});
for(const response of [{status:1,stdout:localDocMarkers.join('\n')},{status:null,error:new Error('child timeout'),stdout:localDocMarkers.join('\n')}])test('local document failure or timeout cannot be redeemed by complete markers',()=>{
 const f=nativeJourney('PACK_LOCAL_DOC',[response],true);assert.equal(f.status,1);assert.deepEqual(f.logs,[]);
});
