import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export type Args = Record<string, unknown>;

export function pick(args: Args, keys: Iterable<string>): Args {
  return Object.fromEntries([...keys].filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
}

export function requireString(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v) throw new BadRequestException(`${key} is required`);
  return v;
}

/** Validates tool arguments with the same DTO the CMS uses, so the integrity rules can't be bypassed. */
export async function dto<T extends object>(cls: new () => T, plain: Args): Promise<T> {
  const clean = Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined));
  const instance = plainToInstance(cls, clean);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    const flat = (e: (typeof errors)[number], path = ''): string[] => [
      ...Object.values(e.constraints ?? {}).map((m) => `${path}${m}`),
      ...(e.children ?? []).flatMap((c) => flat(c, `${path}${e.property}.`)),
    ];
    throw new BadRequestException(errors.flatMap((e) => flat(e)).join('; '));
  }
  return instance;
}
