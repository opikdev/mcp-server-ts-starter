/** Counts requests until their response body is fully sent, so shutdown can wait for them. */
export function createInFlight() {
  let active = 0;
  let waiters: (() => void)[] = [];

  function finish() {
    active -= 1;
    if (active > 0) return;
    for (const resolve of waiters) resolve();
    waiters = [];
  }

  return {
    get active() {
      return active;
    },
    async track(serve: () => Promise<Response>): Promise<Response> {
      active += 1;
      let response: Response;
      try {
        response = await serve();
      } catch (error) {
        finish();
        throw error;
      }
      if (!response.body) {
        finish();
        return response;
      }
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        finish();
      };
      const body = response.body.pipeThrough(new TransformStream({ flush: once, cancel: once }));
      return new Response(body, response);
    },
    idle(): Promise<void> {
      return active === 0 ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve));
    },
  };
}

export type InFlight = ReturnType<typeof createInFlight>;
