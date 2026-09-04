import { EmailCodeSignIn } from "@/components/auth/email-code-sign-in";

export default function SignInPage() {
  return <EmailCodeSignIn defaultDestination="/get-started" />;
}
