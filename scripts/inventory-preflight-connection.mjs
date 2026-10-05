const exactTargetError = "Remote preflight URI must exactly match the expected host, port, database, and user and may contain only sslmode=verify-full.";
const expectedTargetError = "All remote preflight expected-target identifiers are required and must be canonical.";

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
  expectedHost,
  expectedPort,
  expectedDatabase,
  expectedUser,
}) {
  const normalizedHost = canonicalDnsHostname(expectedHost);
  const normalizedPort = expectedPort.trim();
  const normalizedDatabase = expectedDatabase.trim();
  const normalizedUser = expectedUser.trim();
  if (
    !/^\d{1,5}$/.test(normalizedPort)
    || Number(normalizedPort) < 1
    || Number(normalizedPort) > 65_535
    || !/^[A-Za-z0-9_.-]+$/.test(normalizedDatabase)
    || !/^[A-Za-z0-9_.-]+$/.test(normalizedUser)
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
    || username !== normalizedUser
    || decodedPassword.length === 0
  ) {
    throw new Error(exactTargetError);
  }

  const canonical = new URL("postgresql://placeholder.invalid");
  canonical.username = normalizedUser;
  canonical.password = decodedPassword;
  canonical.hostname = normalizedHost;
  canonical.port = normalizedPort;
  canonical.pathname = `/${normalizedDatabase}`;
  canonical.searchParams.set("sslmode", "verify-full");
  return {
    canonicalUri: canonical.toString(),
    password: canonical.password,
    decodedPassword,
    expectedHost: normalizedHost,
    expectedPort: normalizedPort,
    expectedDatabase: normalizedDatabase,
    expectedUser: normalizedUser,
  };
}
