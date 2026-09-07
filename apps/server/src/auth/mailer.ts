import { createTransport } from 'nodemailer';

export type Mail = { to: string; subject: string; text: string };
export type Mailer = { enabled: boolean; send(mail: Mail): Promise<void> };

export const noMailer: Mailer = {
  enabled: false,
  async send() {
    throw new Error('Email delivery is not configured');
  },
};

// SMTP_URL carries host, port, credentials and TLS choice, e.g.
// smtps://user:pass@smtp.example.com:465. Percent-encode the credentials.
export function createMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const url = env.SMTP_URL,
    from = env.MAIL_FROM;
  if (!url || !from) return noMailer;
  const transport = createTransport(url);
  return {
    enabled: true,
    async send(mail) {
      await transport.sendMail({ from, ...mail });
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
