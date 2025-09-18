/**
 *
 * This is an example router, you can delete this file and then update `../pages/api/trpc/[trpc].tsx`
 */
import type { Post } from '@prisma/client';
import { EventEmitter } from 'events';
import { prisma } from '../prisma';
import { authedProcedure, publicProcedure, router } from '../trpc';
import { on } from 'node:events';
import typia, { tags } from 'typia';

type EventMap<T> = Record<keyof T, any[]>;
class IterableEventEmitter<T extends EventMap<T>> extends EventEmitter<T> {
  toIterable<TEventName extends keyof T & string>(
    eventName: TEventName,
    opts?: NonNullable<Parameters<typeof on>[2]>,
  ): AsyncIterable<T[TEventName]> {
    return on(this as any, eventName, opts) as any;
  }
}

interface IterableHelperProps<
  E,
  T extends EventMap<E>,
  K extends keyof T & string,
  R,
> {
  events: IterableEventEmitter<T>;
  event: K;
  signal?: AbortSignal;
  onData: (data: T[K]) => R | undefined;
}

async function* iterableHelper<
  E,
  T extends EventMap<E>,
  K extends keyof T & string,
  R,
>({ events, event, signal, onData }: IterableHelperProps<E, T, K, R>) {
  for await (const data of events.toIterable(event, { signal })) {
    const result = onData(data);
    if (result !== undefined) {
      yield result;
    }
  }
}

interface MyEvents {
  add: [Post];
  isTypingUpdate: [];
}

// In a real app, you'd probably use Redis or something
const ee = new IterableEventEmitter<MyEvents>();

// who is currently typing, key is `name`
const currentlyTyping: Record<string, { lastTyped: Date }> =
  Object.create(null);

// every 1s, clear old "isTyping"
const interval = setInterval(() => {
  let updated = false;
  const now = Date.now();
  for (const [key, value] of Object.entries(currentlyTyping)) {
    if (now - value.lastTyped.getTime() > 3e3) {
      delete currentlyTyping[key];
      updated = true;
    }
  }
  if (updated) {
    ee.emit('isTypingUpdate');
  }
}, 3e3);
process.on('SIGTERM', () => {
  clearInterval(interval);
});

type ITestAdd = {
  id?: string
  text: string
}

const ITestAddValidator = typia.createAssert<ITestAdd>()

type IIsTyping = {
  typing: boolean
}

const IIsTypingValidator = typia.createAssert<IIsTyping>()

type IInfinite = {
  cursor?: Date | null
  take?: (number & tags.Minimum<1> & tags.Maximum<50>) | null 
}

const IInfiniteValidator = typia.createAssert<IInfinite>()

export const postRouter = router({
  add: authedProcedure
    .input(ITestAddValidator)
    .mutation(async (opts) => {
      const { input, ctx } = opts;
      const { name } = ctx.user;
      const post = await prisma.post.create({
        data: {
          ...input,
          name,
          source: 'GITHUB',
        },
      });
      ee.emit('add', post);
      delete currentlyTyping[name];
      ee.emit('isTypingUpdate');
      return post;
    }),

  isTyping: authedProcedure
    .input(IIsTypingValidator)
    .mutation((opts) => {
      const { input, ctx } = opts;
      const { name } = ctx.user;
      if (!input.typing) {
        delete currentlyTyping[name];
      } else {
        currentlyTyping[name] = {
          lastTyped: new Date(),
        };
      }
      ee.emit('isTypingUpdate');
    }),

  infinite: publicProcedure
    .input(
      IInfiniteValidator
    )
    .query(async (opts) => {
      const { input } = opts;
      const take = input.take ?? 10;
      const cursor = input.cursor;

      const page = await prisma.post.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        cursor: cursor ? { createdAt: cursor } : undefined,
        take: take + 1,
        skip: 0,
      });
      const items = page.reverse();
      let nextCursor: typeof cursor | null = null;
      if (items.length > take) {
        const prev = items.shift();

        nextCursor = prev!.createdAt;
      }
      return {
        items,
        nextCursor,
      };
    }),

  onAdd: publicProcedure.subscription((opts) => {
    return iterableHelper({
      events: ee,
      event: 'add',
      signal: opts.signal,
      onData: ([data]) => data,
    });
  }),

  whoIsTyping: publicProcedure.subscription((opts) => {
    return iterableHelper({
      events: ee,
      event: 'isTypingUpdate',
      signal: opts.signal,
      onData: () => Object.keys(currentlyTyping),
    });
  }),
});
