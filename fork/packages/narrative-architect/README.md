# Narrative Architect

Pre-generation structural pass for Roleplay and Game modes.

Builds the scene's logical skeleton before any prose is written:
- **Information Asymmetry**: what each character knows vs. what they are hiding
- **Recursive Dramatic Beats**: the step-by-step emotional and factual progression
- **Turning Point**: the pivot where emotional leverage or dynamic flips
- **Next Shift**: how the ending alters the narrative dynamic for the next chapter

## Zero "Noop" Tax with the Decision Model

Running a heavy thinking model (`z-ai/glm-5.3:thinking`, DeepSeek R1, Gemini Thinking) on every single roleplay message wastes tokens and adds latency.

Narrative Architect solves this by coupling to Marinara's local **Decision Model**:
1. On each turn, your configured Decision Model evaluates whether the latest messages began a new scene, moved locations, or concluded an encounter.
2. If the scene is ongoing, Narrative Architect **skips the thinking model entirely** and injects the cached beat sheet into prompt context at zero cloud cost.
3. Only when a scene boundary is detected (or on the first message) does it invoke your thinking model to architect the next scene skeleton.

## Configuration

Enable **Narrative Architect** under **Chat Settings → Agents → Writer Agents**.
You can assign it to any model connection (such as your dedicated thinking model connection).
