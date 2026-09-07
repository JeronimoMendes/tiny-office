import { describe, expect, it } from 'vitest';
import { createMailer, redactSmtpUrl, signInMail } from '../../apps/server/src/auth/mailer';

const collect = () => {
  const errors: string[] = [];
  return { errors, onError: (message: string) => errors.push(message) };
};

describe('createMailer', () => {
  it('stays off until both the server and the from address are set', () => {
    expect(createMailer({}).enabled).toBe(false);
    expect(createMailer({ SMTP_URL: 'smtps://user:pass@smtp.test:465' }).enabled).toBe(false);
    expect(createMailer({ MAIL_FROM: 'office@example.test' }).enabled).toBe(false);
  });

  it('enables delivery for a well-formed SMTP URL', () => {
    const mailer = createMailer({
      SMTP_URL: 'smtp://user:pass@smtp.test:587',
      MAIL_FROM: 'Tiny Office <office@example.test>',
    });
    expect(mailer.enabled).toBe(true);
  });

  const secret = 'xsmtpsib-not-a-real-key';
  it('accepts a value pasted with surrounding quotes or whitespace', () => {
    const mailer = createMailer({
      SMTP_URL: '  "smtps://relay:pass@smtp.test:465"  ',
      MAIL_FROM: 'office@example.test',
    });
    expect(mailer.enabled).toBe(true);
  });

  it.each([
    ['a stray scheme after the credentials', `smtps://relay:${secret}@://smtp.test:587`],
    ['no scheme at all', `smtp.test:587`],
    ['a scheme that is not SMTP', `https://relay:${secret}@smtp.test:587`],
  ])('keeps the office up when SMTP_URL has %s', (_case, SMTP_URL) => {
    const { errors, onError } = collect();
    const mailer = createMailer({ SMTP_URL, MAIL_FROM: 'office@example.test' }, onError);
    expect(mailer.enabled).toBe(false);
    expect(errors).toHaveLength(1);
    // The URL carries the SMTP password, so it must never reach a log.
    expect(errors[0]).not.toContain(secret);
    expect(errors[0]).toContain('email sign-in stays off');
    // The host is what the operator needs to see to spot the typo.
    expect(errors[0]).toContain('smtp.test');
  });

  it('masks a password containing an unencoded @ rather than half of it', () => {
    const { errors, onError } = collect();
    createMailer(
      { SMTP_URL: `https://relay:pa${secret}@ss@smtp.test:587`, MAIL_FROM: 'office@example.test' },
      onError,
    );
    expect(errors[0]).not.toContain(secret);
    expect(errors[0]).toContain('//***@smtp.test:587');
  });
});

it('addresses the sign-in email to the workspace and states the expiry', () => {
  const mail = signInMail('Tiny Office', 'https://office.test/#login=secret', 24);
  expect(mail.subject).toBe('Your sign-in link for Tiny Office');
  expect(mail.text).toContain('https://office.test/#login=secret');
  expect(mail.text).toContain('expires in 24 hours');
});

it('leaves a credential-free SMTP URL readable while masking a query secret', () => {
  expect(redactSmtpUrl('smtp://smtp.test:587')).toBe('smtp://smtp.test:587');
  expect(redactSmtpUrl('smtp://smtp.test:587?token=abc')).toBe('smtp://smtp.test:587?***');
});
