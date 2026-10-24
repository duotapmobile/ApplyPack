import type { Metadata } from "next";
import { EmailCodeSignIn } from "@/components/auth/email-code-sign-in";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SignInPage() {
  return <EmailCodeSignIn defaultDestination="/get-started" />;
}
