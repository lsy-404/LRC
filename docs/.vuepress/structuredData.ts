import type { Page } from "vuepress";

const ALBUM_PREFIX = "/albums/";

function field(content: string, label: string): string[] {
  const match = content.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`));
  return match ? match[1].split("、").map((item) => item.trim()).filter(Boolean) : [];
}

function trackNames(content: string): string[] {
  const section = content.split(/^## 曲目列表\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  return [...section.matchAll(/^- \[([^\]]+)\]\(/gm)].map((match) => match[1]);
}

const people = (names: string[]) =>
  names.length ? names.map((name) => ({ "@type": "Person", name })) : undefined;

export function albumStructuredData(page: Page, hostname: string) {
  if (!page.path.startsWith(ALBUM_PREFIX) || !page.path.endsWith(".html")) return null;

  const url = `${hostname}${page.path}`;
  const publisher = (page.frontmatter.category as string[] | undefined)?.[0];
  const date = page.frontmatter.date as string | Date | undefined;
  const tracks = trackNames(page.content);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "MusicAlbum",
        "@id": `${url}#album`,
        url,
        name: page.title,
        description: page.frontmatter.description,
        inLanguage: "zh-CN",
        datePublished: date ? new Date(date).toISOString().slice(0, 10) : undefined,
        byArtist: people(field(page.content, "演唱")),
        producer: publisher && publisher !== "未知出品方" ? { "@type": "Organization", name: publisher } : undefined,
        numTracks: tracks.length || undefined,
        track: tracks.length
          ? tracks.map((name, index) => ({ "@type": "MusicRecording", name, position: index + 1 }))
          : undefined,
        isPartOf: { "@id": `${hostname}/#website` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "首页", item: `${hostname}/` },
          { "@type": "ListItem", position: 2, name: page.title, item: url },
        ],
      },
    ],
  };
}

export function siteStructuredData<T extends Record<string, unknown>>(jsonLD: T, page: Page, hostname: string): T {
  if (page.path !== "/") return jsonLD;
  const { "@context": _context, ...webPage } = jsonLD;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${hostname}/#website`,
        url: `${hostname}/`,
        name: "V宇宙词站",
        description: page.frontmatter.description,
        inLanguage: "zh-CN",
      },
      webPage,
    ],
  } as unknown as T;
}
