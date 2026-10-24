const exactTargetError = "Remote preflight URI must exactly match the expected host, port, database, and login user and may contain only sslmode=verify-full.";
const expectedTargetError = "All remote preflight expected-target identifiers are required and must be canonical.";
const deploymentBindingError = "Remote preflight target does not match the checked-in deployment project binding.";

export const PREFLIGHT_DEPLOYMENT_PROJECT_REFS = Object.freeze({
  staging: "fmugizadzdnqfckujqlw",
});

const canonicalDnsHostname = (value) => {
  const hostname = value.trim().toLowerCase();
  const labels = hostname.split(".");
  if (
    hostname.length > 253
    || !hostname.includes(".")
    || !/[a-z]/.test(hostname)
    || labels.some((label) => (
      label.length < 1
      || label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    ))
  ) {
    throw new Error(expectedTargetError);
  }
  return hostname;
};

export function environmentWithoutPreflightSecrets(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !key.toUpperCase().startsWith("AP_PREMIGRATION_"),
    ),
  );
}

export function validateAndCanonicalizePreflightConnection({
  uri,
  deploymentEnvironment,
  expectedHost,
  expectedPort,
  expectedDatabase,
  expectedLoginUser,
  expectedCurrentUser,
}) {
  const normalizedDeploymentEnvironment = deploymentEnvironment.trim().toLowerCase();
  const expectedProjectRef = PREFLIGHT_DEPLOYMENT_PROJECT_REFS[normalizedDeploymentEnvironment];
  if (!expectedProjectRef) throw new Error(deploymentBindingError);
  const normalizedHost = canonicalDnsHostname(expectedHost);
  const normalizedPort = expectedPort.trim();
  const normalizedDatabase = expectedDatabase.trim();
  const normalizedLoginUser = expectedLoginUser.trim();
  const normalizedCurrentUser = expectedCurrentUser.trim();
  if (
    !/^\d{1,5}$/.test(normalizedPort)
    || Number(normalizedPort) < 1
    || Number(normalizedPort) > 65_535
    || !/^[A-Za-z0-9_.-]+$/.test(normalizedDatabase)
    || !/^[A-Za-z0-9_.-]+$/.test(normalizedLoginUser)
    || !/^[A-Za-z0-9_.-]+$/.test(normalizedCurrentUser)
  ) {
    throw new Error(expectedTargetError);
  }

  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(exactTargetError);
  }
  const queryEntries = [...parsed.searchParams.entries()];
  let database;
  let username;
  let decodedPassword;
  try {
    database = decodeURIComponent(parsed.pathname.slice(1));
    username = decodeURIComponent(parsed.username);
    decodedPassword = decodeURIComponent(parsed.password);
  } catch {
    throw new Error(exactTargetError);
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname.toLowerCase() !== normalizedHost
    || parsed.port !== normalizedPort
    || /[\u0000-\u0020\\'\u007f]/.test(uri)
    || parsed.hash !== ""
    || queryEntries.length !== 1
    || queryEntries[0][0] !== "sslmode"
    || queryEntries[0][1].toLowerCase() !== "verify-full"
    || database !== normalizedDatabase
    || username !== normalizedLoginUser
    || decodedPassword.length === 0
  ) {
    throw new Error(exactTargetError);
  }

  const directHost = `db.${expectedProjectRef}.supabase.co`;
  const isDirect = normalizedHost === directHost;
  const isPooler = normalizedHost.endsWith(".pooler.supabase.com")
    && normalizedLoginUser.endsWith(`.${expectedProjectRef}`)
    && normalizedLoginUser.length > expectedProjectRef.length + 1;
  if (!isDirect && !isPooler) throw new Error(deploymentBindingError);

  const canonical = new URL("postgresql://placeholder.invalid");
  canonical.username = normalizedLoginUser;
  canonical.password = decodedPassword;
  canonical.hostname = normalizedHost;
  canonical.port = normalizedPort;
  canonical.pathname = `/${normalizedDatabase}`;
  canonical.searchParams.set("sslmode", "verify-full");
  return {
    canonicalUri: canonical.toString(),
    password: canonical.password,
    decodedPassword,
    deploymentEnvironment: normalizedDeploymentEnvironment,
    expectedProjectRef,
    endpointType: isDirect ? "direct" : "session-pooler",
    expectedHost: normalizedHost,
    expectedPort: normalizedPort,
    expectedDatabase: normalizedDatabase,
    expectedLoginUser: normalizedLoginUser,
    expectedCurrentUser: normalizedCurrentUser,
  };
}
