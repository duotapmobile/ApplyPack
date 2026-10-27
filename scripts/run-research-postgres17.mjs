import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripVTControlCharacters} from 'node:util';

export const RESEARCH_POSTGRES_IMAGE='postgres:17-trixie@sha256:3518071376d0b6156b02e1db2747a78511b5b9dc3763cc79c506ebe2dc2ee71c';
export const RESEARCH_NODE_IMAGE='node:22-bookworm-slim@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09';
const schema='202610270105', label='research-route-postgres17', bin='/usr/lib/postgresql/17/bin/';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=fileURLToPath(new URL('../',import.meta.url));
const selections=Object.freeze(['src','supabase/migrations','package.json','package-lock.json','tsconfig.json',
  'scripts/run-research-native-journey.mjs','scripts/lib','vitest.research-container.config.mjs',
  'tests/integration/automatic-research-preparation.sql','tests/integration/retention-postgres17-bootstrap.sql',
  'tests/integration/research-local-database.ts','tests/integration/research-local-postgres.ts','tests/integration/research-preparation-journey.test.ts',
  'tests/integration/material-clarification-route-journey.test.ts','tests/integration/material-clarification-confirmation.sql',
  'tests/integration/intake-notification-native-journey.test.ts','tests/integration/verified-intake-ownership.sql',
  'tests/integration/verified-intake-payment.sql','tests/integration/reviewed-source-fixture.sql',
  'tests/integration/verified-paid-search-native-journey.test.ts','tests/integration/verified-paid-search-setup.ts','tests/integration/paid-search-provider-fixture.ts',
  'tests/integration/employer-rule-owner-native-journey.test.ts','tests/integration/employer-question-source-fixture.ts']);

/** Exact Git bytes only. The fixture never mounts a developer checkout or .env. */
export function prepareResearchPostgresInputs({execute=execFileSync, environment={PATH:process.env.PATH},repositoryRoot=root}={}) {
  const root=repositoryRoot;
  const git=args=>execute('git',args,{cwd:root,env:environment,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:1024*1024});
  assert.equal(realpathSync(git(['rev-parse','--show-toplevel']).trim()),realpathSync(root),'RESEARCH_REPOSITORY_IDENTITY');
  const commit=git(['rev-parse','HEAD']).trim();assert(/^[a-f0-9]{40}$/u.test(commit),'RESEARCH_COMMIT_IDENTITY');
  mkdirSync(join(root,'evidence'),{recursive:true});
  const directory=mkdtempSync(join(root,'evidence/research-route-pg17-'));
  const workspace=join(directory,'source');mkdirSync(workspace);
  const archive=join(directory,'source.tar');
  execute('git',['-c','core.autocrlf=false','-c','core.eol=lf','archive','--format=tar','--output',archive,commit,'--',...selections],{cwd:root,env:environment,timeout:60000,windowsHide:true});
  execute('tar',['-xf',archive,'-C',workspace],{env:environment,timeout:60000,windowsHide:true});
  for(const path of selections) assert(existsSync(join(workspace,path)),`RESEARCH_COMMITTED_INPUT_MISSING:${path}`);
  const hashes=[];
  function inventory(directory,prefix='') {
    for(const name of readdirSync(directory).sort()) {
      const path=join(directory,name), relative=prefix?`${prefix}/${name}`:name, info=lstatSync(path);
      assert(!info.isSymbolicLink(),'RESEARCH_SOURCE_SYMLINK');
      if(info.isDirectory()) inventory(path,relative);
      else {assert(info.isFile(),'RESEARCH_SOURCE_FILE_TYPE');const bytes=readFileSync(path);hashes.push({path:relative,sha256:digest(bytes),bytes:bytes.length});}
    }
  }
  inventory(workspace);
  // Archive can apply attributes or host line-ending configuration. Compare
  // every extracted file against its actual Git blob identity before execution.
  const tree=git(['ls-tree','-rz',commit,'--',...selections]).split('\0').filter(Boolean);
  const blobs=new Map(tree.map(entry=>{
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/u.exec(entry);
    assert(match,'RESEARCH_GIT_FILE_TYPE');return [match[3],match[2]];
  }));
  assert.equal(blobs.size,hashes.length,'RESEARCH_GIT_FILE_COUNT');
  for(const file of hashes){const bytes=readFileSync(join(workspace,file.path));const blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');assert.equal(blob,blobs.get(file.path),`RESEARCH_GIT_BYTES_CHANGED:${file.path}`);}
  const migrationNames=readdirSync(join(workspace,'supabase/migrations')).filter(name=>name.endsWith('.sql')).sort();
  assert(migrationNames.length>0&&migrationNames.every(name=>/^\d{12}_[a-z0-9_]+\.sql$/u.test(name)),'RESEARCH_MIGRATION_NAME');
  assert.equal(migrationNames.at(-1).slice(0,12),schema,'RESEARCH_SCHEMA_BOUNDARY');
  assert.equal(new Set(migrationNames.map(name=>name.slice(0,12))).size,migrationNames.length,'RESEARCH_MIGRATION_DUPLICATE');
  const readSql=path=>{
    const bytes=readFileSync(join(workspace,path)), text=bytes.toString('utf8');
    assert(Buffer.from(text).equals(bytes)&&bytes.length<2*1024*1024&&!/^\s*\\/mu.test(text),'RESEARCH_SQL_SOURCE_BOUND');
    return text.replace(/^\uFEFF/u,'');
  };
  const sql=[readSql('tests/integration/retention-postgres17-bootstrap.sql'),...migrationNames.map(name=>{
    const version=name.slice(0,12), source=readSql(`supabase/migrations/${name}`), tag=`$research_source_${version}$`;
    assert(!source.includes(tag),'RESEARCH_LEDGER_DELIMITER');
    return `${source}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name.slice(13,-4)}',array[${tag}${source}${tag}]);`;
  })].join('\n');
  assert(Buffer.byteLength(sql)<16*1024*1024,'RESEARCH_SCHEMA_SIZE');
  const dependencies=realpathSync(join(root,'node_modules'));
  assert(statSync(dependencies).isDirectory(),'RESEARCH_DEPENDENCIES_MISSING');
  // Docker cannot create a nested bind target inside the read-only source
  // mount. Reserve an empty target after verifying every committed file.
  mkdirSync(join(workspace,'node_modules'));
  const metadata={commit,schemaVersion:schema,migrationCount:migrationNames.length,sourceArchiveSha256:digest(readFileSync(archive)),inputHashes:hashes};
  writeFileSync(join(directory,'inputs.json'),JSON.stringify(metadata,null,2)+'\n');
  return {workspace,dependencies,directory,sql,...metadata};
}

function image(metadata,reference,kind) {
  assert(metadata&&/^sha256:[a-f0-9]{64}$/u.test(metadata.Id),'RESEARCH_IMAGE_ID');
  assert.equal(metadata.Os,'linux');assert.equal(metadata.Architecture,'amd64');
  const expected=reference.replace(kind==='postgres'?':17-trixie':':22-bookworm-slim','');
  assert(metadata.RepoDigests?.includes(expected),'RESEARCH_IMAGE_DIGEST');
  if(kind==='postgres') assert(metadata.Config.Env?.includes('PG_MAJOR=17')&&metadata.Config.Env.some(value=>value.startsWith('PG_VERSION=17.11-')),'RESEARCH_POSTGRES_VERSION');
  else assert(metadata.Config.Env?.some(value=>/^NODE_VERSION=22\./u.test(value)),'RESEARCH_NODE_VERSION');
  const volumes=Object.keys(metadata.Config.Volumes||{});
  assert(kind==='postgres'?volumes.every(value=>/^\/var\/lib\/postgresql(?:\/data)?$/u.test(value)):volumes.length===0,'RESEARCH_IMAGE_VOLUME');
  return volumes;
}
function owned(state,name,runId) {
  assert.equal(state.Name,`/${name}`,'RESEARCH_CONTAINER_IDENTITY');
  assert.equal(state.Config?.Labels?.['io.applypack.fixture'],label,'RESEARCH_CONTAINER_IDENTITY');
  assert.equal(state.Config?.Labels?.['io.applypack.fixture-run'],runId,'RESEARCH_CONTAINER_IDENTITY');
  assert(/^[a-f0-9]{64}$/u.test(state.Id),'RESEARCH_CONTAINER_ID');
}
function isolated(state,imageId,network,binds=[]) {
  assert.equal(state.Image,imageId);assert.equal(state.Config.User,'65534:65534');
  assert.equal(state.HostConfig.NetworkMode,network,'RESEARCH_NETWORK_ISOLATION');
  assert.equal(state.HostConfig.ReadonlyRootfs,true);assert.equal(state.HostConfig.Privileged,false);
  assert.equal(Object.keys(state.HostConfig.PortBindings||{}).length,0);assert.equal(state.HostConfig.PublishAllPorts,false);
  assert.equal(state.HostConfig.Memory,(binds.length?1536:768)*1024*1024);assert.equal(state.HostConfig.PidsLimit,binds.length?128:64);
  assert.equal(state.HostConfig.NanoCpus,2_000_000_000);assert(state.HostConfig.CapDrop?.includes('ALL'));
  assert(state.HostConfig.SecurityOpt?.includes('no-new-privileges'));
  const actual=(state.Mounts||[]).filter(value=>value.Type==='bind');
  assert.equal(actual.length,binds.length,'RESEARCH_MOUNT_SCOPE');
  for(const expected of binds)assert(actual.some(value=>value.Source===expected.source&&value.Destination===expected.destination&&value.RW===false),'RESEARCH_READONLY_MOUNT');
  assert((state.Mounts||[]).every(value=>['tmpfs','bind'].includes(value.Type)),'RESEARCH_MOUNT_TYPE');
}

/** Each scenario has its own networkless namespace and database. */
export function runResearchPostgres17(args=[],{execute=execFileSync,environment=process.env,platform=process.platform,uuid=randomUUID,inputs=prepareResearchPostgresInputs,write=writeFileSync}={}) {
  assert.deepEqual(args,[],'RESEARCH_ARGUMENTS_FORBIDDEN');assert.equal(platform,'linux','RESEARCH_CI_LINUX_REQUIRED');
  for(const [key,value]of Object.entries(environment))if(value&&/^(?:DOCKER_|CONTAINER_HOST$|PG|DATABASE_URL$|SUPABASE_|NEXT_PUBLIC_SUPABASE_|AP_RESEARCH_TEST_)/iu.test(key))throw new Error('RESEARCH_EXTERNAL_ENVIRONMENT_FORBIDDEN');
  const childEnvironment=Object.fromEntries(Object.entries(environment).filter(([key])=>/^(PATH|HOME|TMPDIR)$/u.test(key)));
  const docker=(parameters,input,timeout=30000)=>execute('docker',['--host','unix:///var/run/docker.sock',...parameters],{input,encoding:'utf8',env:childEnvironment,timeout,windowsHide:true,maxBuffer:16*1024*1024});
  const prepared=inputs({execute,environment:childEnvironment});
  assert(/^[a-f0-9]{40}$/u.test(prepared.commit)&&prepared.schemaVersion===schema,'RESEARCH_SOURCE_IDENTITY');
  assert([prepared.workspace,prepared.dependencies,prepared.directory].every(value=>typeof value==='string'&&value.startsWith('/')&&!/[\r\n,]/u.test(value)),'RESEARCH_LOCAL_MOUNT_PATH');
  const pg=JSON.parse(docker(['image','inspect',RESEARCH_POSTGRES_IMAGE]))[0], node=JSON.parse(docker(['image','inspect',RESEARCH_NODE_IMAGE]))[0];
  const volumes=image(pg,RESEARCH_POSTGRES_IMAGE,'postgres');image(node,RESEARCH_NODE_IMAGE,'node');
  const results=[];
  for(const scenario of ['QUALIFIED','LIMITED','PAID_SEARCH','EMPLOYER_RULE']) {
    const runId=uuid();assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(runId),'RESEARCH_RUN_ID');
    const pgName=`applypack-research-pg-${runId}`, nodeName=`applypack-research-node-${runId}`, marker=runId.replaceAll('-','');
    const attempted=[], common=['--pull','never','--read-only','--user','65534:65534','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','2'];
    const labels=['--label',`io.applypack.fixture=${label}`,'--label',`io.applypack.fixture-run=${runId}`];
    const inspect=name=>JSON.parse(docker(['inspect',name]))[0];
    const local=(binary,parameters,input,timeout)=>docker(['exec','-i',pgName,'/usr/bin/env','-i',`PATH=${bin}:/usr/bin:/bin`,'HOME=/tmp','LANG=C.UTF-8','LC_ALL=C.UTF-8','TZ=UTC','PGOPTIONS=-c statement_timeout=60000 -c lock_timeout=10000',binary,...parameters],input,timeout);
    let primaryError, succeeded=false, phase='database-setup';
    try {
      attempted.push(pgName);
      docker(['create','--name',pgName,...labels,...common,'--network','none','--memory','768m','--pids-limit','64','--shm-size','32m','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=512m',
        ...volumes.flatMap(value=>['--tmpfs',`${value}:rw,noexec,nosuid,nodev,size=16m`]),'--entrypoint','/bin/sleep',pg.Id,'1200']);
      const pgState=inspect(pgName);owned(pgState,pgName,runId);isolated(pgState,pg.Id,'none');docker(['start',pgName]);
      local('/bin/mkdir',['-m','0700','/tmp/research']);
      local(`${bin}initdb`,['-D','/tmp/research/data','-U','postgres','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale']);
      local(`${bin}pg_ctl`,['-D','/tmp/research/data','-l','/tmp/research/postgres.log','-w','-t','30','start','-o','-h 127.0.0.1 -p 5432 -k /tmp/research -c max_connections=12 -c shared_buffers=16MB -c unix_socket_permissions=0700'],undefined,45000);
      const check=`do $$ begin if current_setting('server_version') not like '17.11%' or current_setting('listen_addresses')<>'127.0.0.1' or inet_server_addr()<>'127.0.0.1'::inet then raise exception 'research_isolated_database_required'; end if; end $$;`;
      const setup=local(`${bin}psql`,['-X','-q','-h','127.0.0.1','-p','5432','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],`${check}\n${prepared.sql}\ncreate table public.ap_research_local_test_identity(marker text primary key); insert into public.ap_research_local_test_identity values('${marker}'); select 'RESEARCH_SCHEMA_READY';`,600000);
      assert(setup.split(/\r?\n/u).some(line=>line.trim()==='RESEARCH_SCHEMA_READY'),'RESEARCH_SCHEMA_MARKER');
      const current=inspect(pgName);owned(current,pgName,runId);isolated(current,pg.Id,'none');assert.equal(current.Id,pgState.Id,'RESEARCH_SERVER_REPLACED');
      const binds=[{source:prepared.workspace,destination:'/workspace'},{source:prepared.dependencies,destination:'/workspace/node_modules'}];
      attempted.push(nodeName);
      docker(['create','--name',nodeName,...labels,...common,'--network',`container:${pgState.Id}`,'--memory','1536m','--pids-limit','128',
        '--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=128m','--workdir','/workspace',...binds.flatMap(value=>['--mount',`type=bind,src=${value.source},dst=${value.destination},readonly`]),
        '--env','HOME=/tmp','--env','TMPDIR=/tmp','--env','AP_RESEARCH_TEST_MODE=CONTAINER_PG17','--env','AP_RESEARCH_TEST_PORT=5432','--env',`AP_RESEARCH_TEST_MARKER=${marker}`,
        '--entrypoint','/usr/local/bin/node',node.Id,'--max-old-space-size=1024','scripts/run-research-native-journey.mjs',scenario]);
      const nodeState=inspect(nodeName);owned(nodeState,nodeName,runId);isolated(nodeState,node.Id,`container:${pgState.Id}`,binds);
      phase='actual-route-journey';
      const output=docker(['start','--attach',nodeName],undefined,330000);
      write(join(prepared.directory,`${scenario.toLowerCase()}.log`),output);
      const requiredMarker=scenario==='EMPLOYER_RULE'?'EMPLOYER_RULE_ROUTE_DATABASE_JOURNEY_OK:':scenario==='PAID_SEARCH'?'PAID_SEARCH_ROUTE_DATABASE_JOURNEY_OK:':'RESEARCH_ROUTE_DATABASE_JOURNEY_OK:';
      assert(output.split(/\r?\n/u).some(line=>line.startsWith(requiredMarker)),'RESEARCH_ROUTE_MARKER');
      if(scenario==='EMPLOYER_RULE')assert(stripVTControlCharacters(output).split(/\r?\n/u).some(line=>/^EMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK(?: |$)/u.test(line.trim())),'EMPLOYER_RULE_OWNER_MARKER');
      if(scenario==='LIMITED')assert(output.split(/\r?\n/u).some(line=>line==='RESEARCH_CLARIFICATION_NOTIFICATION_JOURNEYS_OK'),'RESEARCH_AGGREGATE_MARKER');
      const stopped=inspect(nodeName);owned(stopped,nodeName,runId);isolated(stopped,node.Id,`container:${pgState.Id}`,binds);
      assert(stopped.State?.Running===false&&stopped.State?.ExitCode===0&&stopped.State?.OOMKilled===false,'RESEARCH_ROUTE_EXIT');
      const finalPg=inspect(pgName);owned(finalPg,pgName,runId);isolated(finalPg,pg.Id,'none');assert.equal(finalPg.Id,pgState.Id);
      succeeded=true;
    }catch(error){
      primaryError=error;
      const output=typeof error?.stdout==='string'?error.stdout:Buffer.isBuffer(error?.stdout)?error.stdout.toString('utf8'):'';
      write(join(prepared.directory,`${scenario.toLowerCase()}-failure.log`),`Failed phase: ${phase}\n${output.slice(0,256*1024)}`);
    }
    finally {
      const cleanupErrors=[];
      for(const name of [...attempted].reverse())try {
        if(docker(['ps','--all','--quiet','--filter',`name=^/${name}$`]).trim()){
          owned(inspect(name),name,runId);docker(['rm','--force','--volumes',name]);
        }
        assert.equal(docker(['ps','--all','--quiet','--filter',`name=^/${name}$`]).trim(),'','RESEARCH_TEARDOWN_INCOMPLETE');
      }catch(error){cleanupErrors.push(error);}
      if(cleanupErrors.length)throw new AggregateError([...(primaryError?[primaryError]:[]),...cleanupErrors],'RESEARCH_CLEANUP_FAILED');
    }
    if(primaryError)throw primaryError;assert(succeeded);results.push({scenario,status:'PASS',teardownVerified:true});
  }
  return {status:'PASS',scope:'actual-routes-fictional-boundaries-networkless-postgres17',sourceCommit:prepared.commit,schemaVersion:schema,
    migrationCount:prepared.migrationCount,inputHashes:prepared.inputHashes,sourceArchiveSha256:prepared.sourceArchiveSha256,
    postgresImage:RESEARCH_POSTGRES_IMAGE,nodeImage:RESEARCH_NODE_IMAGE,results,providerCalls:0,hostedProof:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(runResearchPostgres17(process.argv.slice(2)),null,2));
