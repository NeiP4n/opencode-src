import { describe, expect, test } from "bun:test"
import { Result } from "effect"
import { SessionID } from "@opencode/schema/session-id"
import { Note } from "@opencode/schema/note"

const frontmatter: Note.Frontmatter = {
  title: "План по сети комнат",
  status: "active",
  tags: ["net", "lan", "lan-rooms"],
  session: SessionID.make("ses_01"),
  created: 1758000000000,
  updated: 1758000900000,
}

const markdown = [
  "---",
  "title: План по сети комнат",
  "status: active",
  "tags: [net, lan, lan-rooms]",
  "session: ses_01",
  "created: 1758000000000",
  "updated: 1758000900000",
  "---",
  "",
  "Тело заметки.",
].join("\n")

const blank: Note.Frontmatter = {
  title: "",
  status: "inbox",
  tags: [],
  session: undefined,
  created: 0,
  updated: 0,
}

describe("note frontmatter", () => {
  test("a full note round-trips through serialize and parse", () => {
    const file = Note.parse(markdown)

    expect(file.frontmatter).toEqual(frontmatter)
    expect(file.body).toBe("Тело заметки.")

    const again = Note.parse(Note.serialize(file))

    expect(again.frontmatter).toEqual(file.frontmatter)
    expect(again.body).toBe(file.body)
  })

  test("serialize writes a fixed field order so a rewrite produces no diff", () => {
    expect(Note.serialize({ frontmatter, body: "Тело заметки." })).toBe(markdown)
  })

  test("a line without a separator is not a field and does not hide the other fields", () => {
    const file = Note.parse("---\ntitle: Первая\nвторая строка\nstatus: done\n---\n\nтело")

    // Значения frontmatter однострочные по контракту заметки: продолжение без двоеточия —
    // мусор, а не часть заголовка, поэтому заголовок обрывается, а остальные поля читаются.
    expect(file.frontmatter.title).toBe("Первая")
    expect(file.frontmatter.status).toBe("done")
    expect(file.body).toBe("тело")
  })

  test("broken frontmatter degrades to inbox and keeps nothing it could not read", () => {
    const line = "заголовок без двоеточия"
    const file = Note.parse(
      `---\n${line}\nstatus: nonsense\ncreated: не число\nsession: не-id\ntags: [Net, ok]\n---\n\nтело`,
    )

    expect(file.frontmatter.status).toBe("inbox")
    expect(file.frontmatter.title).not.toBe(line)
    expect(file.frontmatter.title).toBe("")
    expect(file.frontmatter.created).toBe(0)
    expect(file.frontmatter.updated).toBe(0)
    expect(file.frontmatter.session).toBeUndefined()
    // a tag that is not a latin slug is dropped, the valid one survives
    expect(file.frontmatter.tags).toEqual(["ok"])
    expect(file.body).toBe("тело")
  })

  test("one junk line does not cost the note the fields that were readable", () => {
    const file = Note.parse("---\ntitle: Только это\nи мусор\n---\n\nтело")

    // Деградация построчная: одна испорченная строка не должна обнулять читаемую заметку,
    // иначе правка руки или старой версии агента обнулила бы весь список заметок.
    expect(file.frontmatter.title).toBe("Только это")
    expect(file.frontmatter.status).toBe("inbox")
    expect(file.body).toBe("тело")
  })

  test("a file without any fence is all body", () => {
    const file = Note.parse("title: без разделителя вообще\n\nтело")

    expect(file.frontmatter).toEqual(blank)
    expect(file.body).toBe("title: без разделителя вообще\n\nтело")
  })

  test("a missing closing fence keeps the whole file as the body", () => {
    const text = "---\ntitle: Без закрытия\nstatus: done\nтело"
    const file = Note.parse(text)

    expect(file.frontmatter).toEqual(blank)
    expect(file.body).toBe(text)
  })

  test("the serialized fallback is itself parseable", () => {
    const file = Note.parse("никакого frontmatter")

    expect(Note.parse(Note.serialize(file)).frontmatter).toEqual(file.frontmatter)
    expect(Note.parse(Note.serialize(file)).body).toBe(file.body)
  })
})

describe("note name", () => {
  test("names that would leave the notes folder are refused, not repaired", () => {
    const refused = [
      "заметка",
      "моя заметка",
      "my.note",
      "a/b",
      "..",
      "../escape",
      "my note",
      "",
      "   ",
      "-leading",
      "1digit",
      "x".repeat(61),
    ]

    for (const input of refused) {
      const result = Note.name(input)

      expect(Result.isFailure(result)).toBe(true)
      expect(Note.name(input)).toEqual(Note.name(input))
    }
  })

  test("an acceptable name becomes a slug and its case is folded", () => {
    expect(Note.name("  Plan-Po-Seti  ")).toEqual(Result.succeed(Note.Slug.make("plan-po-seti")))
    expect(Note.name("ab")).toEqual(Result.succeed(Note.Slug.make("ab")))
  })

  test("a refusal carries the offending input and a reason", () => {
    expect(Note.name("")).toEqual(Result.fail({ input: "", reason: "empty" }))
    expect(Note.name("  ")).toEqual(Result.fail({ input: "  ", reason: "empty" }))
    expect(Note.name("x")).toEqual(Result.fail({ input: "x", reason: "too_short" }))
    expect(Note.name("x".repeat(61))).toEqual(Result.fail({ input: "x".repeat(61), reason: "too_long" }))
    expect(Note.name("x".repeat(60))).toEqual(Result.succeed(Note.Slug.make("x".repeat(60))))
    expect(Note.name("my note")).toEqual(Result.fail({ input: "my note", reason: "not_slug" }))
    expect(Note.name("заметка")).toEqual(Result.fail({ input: "заметка", reason: "not_slug" }))
    expect(Note.name("my.note")).toEqual(Result.fail({ input: "my.note", reason: "not_slug" }))
    expect(Note.name("a/b")).toEqual(Result.fail({ input: "a/b", reason: "not_slug" }))
    expect(Note.name("..")).toEqual(Result.fail({ input: "..", reason: "not_slug" }))
  })
})

describe("note name collision", () => {
  const base = Note.Slug.make("plan")

  test("a free name is used as is", () => {
    expect(Note.unique(base, new Set(["other"]))).toEqual(Result.succeed(base))
  })

  test("a taken name gets the first free numeric suffix", () => {
    expect(Note.unique(base, new Set(["plan"]))).toEqual(Result.succeed(Note.Slug.make("plan-2")))
    expect(Note.unique(base, new Set(["plan", "plan-2"]))).toEqual(Result.succeed(Note.Slug.make("plan-3")))
    expect(Note.unique(base, new Set(["plan", "plan-2", "plan-3", "plan-5"]))).toEqual(
      Result.succeed(Note.Slug.make("plan-4")),
    )
  })

  test("a suffix never pushes the name past the length limit", () => {
    const long = Note.Slug.make("a".repeat(60))
    const result = Note.unique(long, new Set([long]))

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      const value = Note.Slug.make(result.success)

      expect(value.length).toBe(60)
      expect(value.endsWith("-2")).toBe(true)
    }
  })
})

describe("note length", () => {
  test("a set length is written after the tags and read back", () => {
    const file = { frontmatter: { ...frontmatter, length: "brief" as const }, body: "Тело заметки." }
    const text = Note.serialize(file)

    expect(text).toBe(markdown.replace("tags: [net, lan, lan-rooms]\n", "tags: [net, lan, lan-rooms]\nlength: brief\n"))
    expect(Note.parse(text).frontmatter).toEqual(file.frontmatter)
  })

  test("a note without a length keeps no length line, so existing files do not change", () => {
    expect(Note.parse(markdown).frontmatter.length).toBeUndefined()
    expect(Note.serialize(Note.parse(markdown))).toBe(markdown)
  })

  test("an unknown length is dropped instead of breaking the note", () => {
    const file = Note.parse("---\ntitle: T\nlength: huge\n---\n\nbody")

    expect(file.frontmatter.length).toBeUndefined()
    expect(file.frontmatter.title).toBe("T")
    expect(Note.FallbackLength).toBe("balanced")
  })
})

describe("note slug from a title", () => {
  test("a latin title becomes a hyphenated slug", () => {
    expect(Note.slugify("  Room Plan: v2!  ")).toBe(Note.Slug.make("room-plan-v2"))
  })

  test("a Cyrillic title is transliterated", () => {
    expect(Note.slugify("План по сети комнат")).toBe(Note.Slug.make("plan-po-seti-komnat"))
    expect(Note.slugify("Щука и ёж")).toBe(Note.Slug.make("shchuka-i-ezh"))
  })

  test("leading digits are dropped and the result fits the length limit", () => {
    expect(Note.slugify("2026 roadmap")).toBe(Note.Slug.make("roadmap"))
    const long = Note.slugify("word ".repeat(30))
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long.endsWith("-")).toBe(false)
  })

  test("a title with nothing usable falls back to note", () => {
    expect(Note.slugify("")).toBe(Note.Slug.make("note"))
    expect(Note.slugify("日本語")).toBe(Note.Slug.make("note"))
    expect(Note.slugify("x")).toBe(Note.Slug.make("note"))
  })
})
