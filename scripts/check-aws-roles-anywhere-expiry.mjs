import { rolesAnywhereCertificateStatus } from "./lib/aws-roles-anywhere.mjs";
try {
  const status = rolesAnywhereCertificateStatus();
  console.log(JSON.stringify(status));
  process.exitCode = status.rotationDue ? 2 : 0;
} catch {
  console.error("AWS_ROLES_ANYWHERE_CERTIFICATE_CHECK_FAILED");
  process.exitCode = 1;
}
