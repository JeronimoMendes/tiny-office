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

// Everything up to the last "@" is the password, and a query string can carry
// one too. Masking both leaves the scheme, host and port, which is the part an
// operator needs to see to spot a typo.
export const redactSmtpUrl = (url: string) =>
  url.replace(/\/\/.*@/, '//***@').replace(/\?.*$/, '?***');

// SMTP_URL carries host, port, credentials and TLS choice, e.g.
// smtps://user:pass@smtp.example.com:465. Percent-encode the credentials.
// A malformed one leaves email sign-in off rather than taking the office down
// with it, and is only ever quoted back redacted.
export function createMailer(
  env: NodeJS.ProcessEnv = process.env,
  onError: (message: string) => void = console.error,
): Mailer {
  // Copy-pasting a value out of a dashboard tends to bring quotes and spaces.
  const url = env.SMTP_URL?.trim().replace(/^(['"])(.*)\1$/, '$2'),
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
      `SMTP_URL is unusable (${(error as Error).message}), so email sign-in stays off. It reads ${redactSmtpUrl(url)} with the password masked; expected smtp://user:pass@host:587 or smtps://user:pass@host:465, credentials percent-encoded.`,
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
