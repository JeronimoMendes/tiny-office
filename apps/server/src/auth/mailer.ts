import { createTransport } from 'nodemailer';

export type Mail = { to: string; subject: string; text: string };
export type Mailer = {
  enabled: boolean;
  send(mail: Mail): Promise<void>;
  // Optional boot-time reachability check; failure is reported, never fatal.
  verify?(): Promise<void>;
};

export const noMailer: Mailer = {
  enabled: false,
  async send() {
    throw new Error('Email delivery is not configured');
  },
};

// SMTP_URL carries host, port, credentials and TLS choice, e.g.
// smtps://user:pass@smtp.example.com:465. Percent-encode the credentials.
// A malformed one leaves email sign-in off rather than taking the office down
// with it, and is never echoed back: it carries the SMTP password.
export function createMailer(
  env: NodeJS.ProcessEnv = process.env,
  onError: (message: string) => void = console.error,
): Mailer {
  const url = env.SMTP_URL,
    from = env.MAIL_FROM;
  if (!url || !from) return noMailer;
  let transport;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'smtp:' && protocol !== 'smtps:')
      throw new Error(`unsupported scheme ${protocol}`);
    if (!hostname) throw new Error('no host');
    transport = createTransport(url);
  } catch (error) {
    onError(
      `SMTP_URL is unusable (${(error as Error).message}), so email sign-in stays off. Expected smtp://user:pass@host:587 or smtps://user:pass@host:465, credentials percent-encoded.`,
    );
    return noMailer;
  }
  return {
    enabled: true,
    async send(mail) {
      await transport.sendMail({ from, ...mail });
    },
    async verify() {
      await transport.verify();
    },
  };
}

export const signInMail = (workspace: string, link: string, hours: number): Omit<Mail, 'to'> => ({
  subject: `Your sign-in link for ${workspace}`,
  text: [
    `Open this link to sign in to ${workspace}:`,
    '',
    link,
    '',
    `It works once and expires in ${hours} hours. If you did not ask to sign in, ignore this email; nobody gains access without the link.`,
  ].join('\n'),
});
