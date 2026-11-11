import type { Env } from "@ecom/config";
import nodemailer from "nodemailer";
import type { Logger } from "../platform/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development fallback: records that an email would have been sent. The body is
 * never logged because it can contain sign-in links and other secrets.
 */
export function createConsoleEmailProvider(logger: Logger): EmailProvider {
  return {
    async send(message) {
      logger.info(
        { to: message.to, subject: message.subject },
        "email not sent (console provider)",
      );
    },
  };
}

export function createSmtpEmailProvider(options: {
  host: string;
  port: number;
  from: string;
  user?: string;
  password?: string;
}): EmailProvider {
  const transport = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.port === 465,
    ...(options.user ? { auth: { user: options.user, pass: options.password ?? "" } } : {}),
  });
  return {
    async send(message) {
      await transport.sendMail({
        from: options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}

/** Keeps messages in memory. For tests. */
export function createMemoryEmailProvider(): EmailProvider & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

type EmailEnv = Pick<
  Env,
  "EMAIL_PROVIDER" | "EMAIL_FROM" | "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASSWORD"
>;

export function createEmailProvider(env: EmailEnv, logger: Logger): EmailProvider {
  if (env.EMAIL_PROVIDER === "smtp") {
    return createSmtpEmailProvider({
      // Presence is guaranteed by environment validation when the provider is smtp.
      host: env.SMTP_HOST!,
      port: env.SMTP_PORT!,
      from: env.EMAIL_FROM,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
    });
  }
  return createConsoleEmailProvider(logger);
}
