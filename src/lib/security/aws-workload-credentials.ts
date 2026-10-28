import "server-only";
import { awsWorkloadCredentials as provider, inspectCertificateMaterial, validateRolesAnywhereConfiguration } from "../../../scripts/lib/aws-roles-anywhere.mjs";

type Environment = Partial<NodeJS.ProcessEnv>;
type TemporaryCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
};

export function awsWorkloadCredentials(environment: Environment = process.env): () => Promise<TemporaryCredentials> {
  return provider(environment) as () => Promise<TemporaryCredentials>;
}

/** Local binding/expiry check only; actual AWS identity is verified on refresh. */
export function awsWorkloadIdentityConfigured(environment: Environment = process.env): boolean {
  try {
    const configuration = validateRolesAnywhereConfiguration(environment);
    const material = inspectCertificateMaterial(environment, configuration);
    material.certificateBytes.fill(0);
    material.caBytes.fill(0);
    material.keyBytes.fill(0);
    return true;
  } catch { return false; }
}
