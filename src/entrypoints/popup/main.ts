import { Effect, Layer, Match } from "effect";
import { MessagingLive } from "../../layers/messaging-live.js";
import {
  ListSavedUrlsRequest,
  RequestEnvelope,
  type Response,
  SaveCurrentTabRequest,
} from "../../services/messages.js";
import { Messaging } from "../../services/services.js";
import "./style.css";

const LiveLayer = Layer.mergeAll(MessagingLive);

const send = (payload: SaveCurrentTabRequest | ListSavedUrlsRequest) =>
  Effect.gen(function* () {
    const messaging = yield* Messaging;
    return yield* messaging.send(new RequestEnvelope({ payload }));
  }).pipe(Effect.provide(LiveLayer));

/** Exhaustive rendering of a response into `{ status, urls }`. */
const render = (
  response: Response,
): { status: string; urls: ReadonlyArray<string> } =>
  Match.value(response).pipe(
    Match.tagsExhaustive({
      SaveCurrentTabSuccess: (r) => ({
        status: r.alreadySaved
          ? "すでに保存済みです"
          : `保存しました: ${r.saved}`,
        urls: [],
      }),
      ListSavedUrlsSuccess: (r) => ({
        status: r.urls.length === 0 ? "まだ保存されたURLはありません" : "",
        urls: r.urls,
      }),
      RequestFailed: (r) => ({
        status: `失敗しました (${r.reason})`,
        urls: [],
      }),
    }),
  );

const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const listEl = document.querySelector<HTMLUListElement>("#urls");
const saveButton = document.querySelector<HTMLButtonElement>("#save");

const setStatus = (text: string) => {
  if (statusEl) {
    statusEl.textContent = text;
  }
};

const setUrls = (urls: ReadonlyArray<string>) => {
  if (!listEl) {
    return;
  }
  listEl.replaceChildren(
    ...urls.map((url) => {
      const li = document.createElement("li");
      li.textContent = url;
      return li;
    }),
  );
};

const load = async () => {
  const response = await Effect.runPromise(send(new ListSavedUrlsRequest()));
  const view = render(response);
  setStatus(view.status);
  setUrls(view.urls);
};

const save = async () => {
  setStatus("保存中…");
  const response = await Effect.runPromise(send(new SaveCurrentTabRequest()));
  const listed = await Effect.runPromise(send(new ListSavedUrlsRequest()));
  const view = render(response);
  setStatus(view.status);
  setUrls(render(listed).urls);
};

saveButton?.addEventListener("click", () => {
  void save();
});

void load();
