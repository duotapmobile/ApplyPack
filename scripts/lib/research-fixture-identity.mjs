/** Test-only loopback identity. Neither mode accepts a database URL or password. */
export function researchFixtureIdentity(environment,platform) {
  const {AP_RESEARCH_TEST_PORT:port,AP_RESEARCH_TEST_MARKER:marker,AP_RESEARCH_TEST_PSQL:binary,AP_RESEARCH_TEST_MODE:mode}=environment;
  if(!/^[1-9][0-9]{3,4}$/u.test(port||'')||Number(port)<1024||Number(port)>65535||!/^[a-f0-9]{32}$/u.test(marker||'')
    ||Object.keys(environment).some(key=>/^(?:PG|DATABASE_URL$|SUPABASE_|NEXT_PUBLIC_SUPABASE_)/iu.test(key)&&environment[key]
      &&!(key==='PGOPTIONS'&&mode!=='CONTAINER_PG17'&&environment[key]==='-c statement_timeout=60000 -c lock_timeout=10000')))throw new Error('local_research_database_environment_rejected');
  if(mode==='CONTAINER_PG17') {
    if(platform!=='linux'||port!=='5432'||binary!==undefined)throw new Error('local_research_container_identity_rejected');
  }else if(mode===undefined||mode==='NATIVE_WINDOWS') {
    if(platform!=='win32'||!binary?.endsWith('psql.exe'))throw new Error('local_research_native_identity_rejected');
  }else throw new Error('local_research_fixture_mode_rejected');
  return {port:Number(port),marker,mode:mode||'NATIVE_WINDOWS'};
}
