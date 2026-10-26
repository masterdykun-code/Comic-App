import "dotenv/config";
import { createMailTransport } from "../config/mail";
async function main() {
  const transport = createMailTransport();
  try {
    await transport.verify();
    console.log("SMTP connection/authentication verified. No email sent.");
  } finally {
    transport.close();
  }
}
main().catch(() => {
  console.error(
    "SMTP check failed. Configure SMTP_HOST/PORT/USER/PASS/FROM in backend/.env, then restart Backend. Credentials suppressed.",
  );
  process.exitCode = 1;
});
