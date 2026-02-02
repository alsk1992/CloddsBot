---
name: tweet-ideas
description: "Generate tweet ideas from trends and project updates"
command: tweets
emoji: "💭"
---

# Tweet Ideas Generator

Generate tweet ideas from market trends OR your project's latest developments.

## Commands

```
/tweets generate [topic]             Generate from trends/topic
/tweets spicy                        Contrarian/provocative takes
/tweets project <path>               Generate about project updates
/tweets changelog <path>             Announce latest changelog entries
/tweets feature <description>        Announce a specific feature
/tweets launch <path>                Generate launch thread
/tweets style <description>          Set your voice/style
/tweets trends                       Show what's trending to riff on
/tweets drafts                       View saved ideas
/tweets save <id>                    Save to drafts
/tweets clear                        Clear drafts
```

## Examples

### Set Your Style
```
/tweets style "contrarian crypto takes, short punchy sentences, no emojis, slightly unhinged, call out hypocrisy"
/tweets style "builder sharing wins, technical but accessible, authentic not hype"
```

### Generate From Trends
```
/tweets generate
/tweets generate "bitcoin etf"
/tweets spicy
```

### Project Announcements
```
/tweets project /path/to/myproject
/tweets changelog /path/to/CHANGELOG.md
/tweets feature "Added SPL token escrow with Pyth oracle conditions"
/tweets launch /path/to/myproject
```

## How It Works

### Trend Mode
- Pulls from crypto news feeds, market data, social signals
- Generates takes in your style
- `/tweets spicy` deliberately goes contrarian

### Project Mode
- Reads CHANGELOG.md for latest updates
- Reads README.md for project description
- Reads package.json for name/version
- Generates announcement tweets in your style

### Style Memory
Your style is saved and persists across sessions. Examples:
- "degen energy, lowercase, lots of slang"
- "thoughtful builder, focus on technical details"
- "provocative, question everything, short sentences"

## Output

Returns 3-5 tweet ideas per generation. Each shows:
- The tweet text
- Character count
- Thread potential (if topic is big)

Save the ones you like with `/tweets save <id>`.
