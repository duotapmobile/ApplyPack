import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import test from 'node:test';
import {prepareResearchPostgresInputs,RESEARCH_NODE_IMAGE,RESEARCH_POSTGRES_IMAGE,runResearchPostgres17} from './run-research-postgres17.mjs';
import {researchFixtureIdentity} from './lib/research-fixture-identity.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const pgId=`sha256:${'a'.repeat(64)}`,nodeId=`sha256:${'b'.repeat(64)}`;
function fixture({fail,drift,missingMarker,ambiguousCreate,cleanupFailure}={}) {
  const calls=[],states=new Map(),writes=[],prepared={commit:'c'.repeat(40),schemaVersion:'202610250100',workspace:'/fixture/source',dependencies:'/fixture/dependencies',directory:'/fixture/evidence',sql:'-- actual schema input placeholder',migrationCount:105,inputHashes:[],sourceArchiveSha256:'d'.repeat(64)};
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
      if(args.includes('--attach')){if(fail==='journey')throw new Error('route assertion failed');return missingMarker?'schema only\n':'RESEARCH_ROUTE_DATABASE_JOURNEY_OK: fictional boundary; real routes\n';}
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
test('runs both original route scenarios in separate owned networkless namespaces and cleans each pair',()=>{
  const f=fixture(),receipt=f.run([],{PATH:'/bin',AWS_SECRET_ACCESS_KEY:'fictional',STRIPE_SECRET_KEY:'fictional'});
  assert.deepEqual(receipt.results.map(value=>value.scenario),['QUALIFIED','LIMITED']);assert.equal(receipt.hostedProof,false);assert.equal(receipt.providerCalls,0);assert.equal(f.states.size,0);
  const created=f.calls.filter(call=>call.args[2]==='create');assert.equal(created.length,4);
  const servers=created.filter(call=>call.args.includes('none')),nodes=created.filter(call=>call.args.some(value=>value.startsWith('container:')));
  assert.equal(servers.length,2);assert.equal(nodes.length,2);assert.notEqual(nodes[0].args[nodes[0].args.indexOf('--network')+1],nodes[1].args[nodes[1].args.indexOf('--network')+1]);
  for(const {args}of nodes){assert(args.includes('AP_RESEARCH_TEST_MODE=CONTAINER_PG17'));assert(args.includes('AP_RESEARCH_TEST_PORT=5432'));const mounts=args.filter(value=>value.startsWith('type=bind'));assert(mounts.every(value=>value.endsWith(',readonly')));assert(!mounts.some(value=>value.includes('.env')||value.includes('docker.sock')));}
  assert(f.calls.every(call=>call.options.env.AWS_SECRET_ACCESS_KEY===undefined&&call.options.env.STRIPE_SECRET_KEY===undefined));
  assert.equal(f.calls.filter(call=>call.args.includes('/usr/lib/postgresql/17/bin/psql')).length,2);
  assert(f.calls.filter(call=>call.args.includes('--attach')).every(call=>call.options.timeout===330000));
  assert.equal(f.writes.length,2);assert(receipt.results.every(value=>value.teardownVerified));
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
test('test identity preserves native mode and requires exact container loopback identity',()=>{
 assert.deepEqual(researchFixtureIdentity({AP_RESEARCH_TEST_PORT:'54321',AP_RESEARCH_TEST_MARKER:marker,AP_RESEARCH_TEST_PSQL:'C:/owned/psql.exe',PGOPTIONS:'-c statement_timeout=60000 -c lock_timeout=10000'},'win32'),{port:54321,marker,mode:'NATIVE_WINDOWS'});
 assert.deepEqual(researchFixtureIdentity({AP_RESEARCH_TEST_PORT:'5432',AP_RESEARCH_TEST_MARKER:marker,AP_RESEARCH_TEST_MODE:'CONTAINER_PG17'},'linux'),{port:5432,marker,mode:'CONTAINER_PG17'});
});
for(const changes of [{AP_RESEARCH_TEST_PORT:'5433'},{AP_RESEARCH_TEST_MARKER:'wrong'},{AP_RESEARCH_TEST_PSQL:'/bin/psql'},{AP_RESEARCH_TEST_MODE:'host'},{DATABASE_URL:'postgres://fictional'},{PGPASSWORD:'fictional'}])test('rejects forged container fixture identity',()=>{assert.throws(()=>researchFixtureIdentity({AP_RESEARCH_TEST_PORT:'5432',AP_RESEARCH_TEST_MARKER:marker,AP_RESEARCH_TEST_MODE:'CONTAINER_PG17',...changes},'linux'));});

test('source preparation archives only committed allowlisted bytes and excludes developer secrets/WIP',()=>{
 const base=resolve(tmpdir()),directory=mkdtempSync(join(base,'applypack-research-input-'));
 const files=['src/example.ts','package.json','package-lock.json','tsconfig.json','scripts/run-research-native-journey.mjs','scripts/lib/research-fixture-identity.mjs','vitest.research-container.config.mjs',
  'tests/integration/automatic-research-preparation.sql','tests/integration/retention-postgres17-bootstrap.sql','tests/integration/research-local-database.ts','tests/integration/research-local-postgres.ts','tests/integration/research-preparation-journey.test.ts','supabase/migrations/202610250100_fictional.sql'];
 try {
  for(const path of files){mkdirSync(dirname(join(directory,path)),{recursive:true});writeFileSync(join(directory,path),path.endsWith('.sql')?'select 1;\n':'committed bytes\n');}
  const git=args=>execFileSync('git',args,{cwd:directory,stdio:'pipe',timeout:30000});
  git(['init','--quiet']);git(['add','--',...files]);git(['-c','user.name=Fictional Test','-c','user.email=fixture@example.invalid','commit','--quiet','-m','fictional fixture']);
  writeFileSync(join(directory,'src/example.ts'),'uncommitted mutation\n');writeFileSync(join(directory,'.env.local'),'PRIVATE_SENTINEL');mkdirSync(join(directory,'node_modules'));
  const prepared=prepareResearchPostgresInputs({repositoryRoot:directory,environment:{PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT}});
  const extracted=readFileSync(join(prepared.workspace,'src/example.ts')),blob=git(['show','HEAD:src/example.ts']);
  assert(extracted.equals(blob),JSON.stringify({extractedHex:extracted.toString('hex'),blobHex:blob.toString('hex')}));assert(!extracted.toString('utf8').includes('uncommitted'));assert(!readdirSync(prepared.workspace).includes('.env.local'));
  assert.equal(prepared.migrationCount,1);assert.match(prepared.sql,/schema_migrations/u);assert(prepared.inputHashes.every(value=>/^[a-f0-9]{64}$/u.test(value.sha256)));
 }finally {
  const target=resolve(directory);assert(target.startsWith(base+sep)&&target.slice(base.length+1).startsWith('applypack-research-input-'));rmSync(target,{recursive:true,force:true});
 }
});
