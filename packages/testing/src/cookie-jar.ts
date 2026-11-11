/** Minimal cookie jar for driving the auth service outside a browser. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Applies Set-Cookie header values. */
  absorb(setCookies: string[]): this {
    for (const header of setCookies) {
      const [pair = "", ...attributes] = header.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return this;
  }

  headers(): Headers {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    return new Headers(cookie ? { cookie } : {});
  }

  names(): string[] {
    return [...this.cookies.keys()];
  }
}
