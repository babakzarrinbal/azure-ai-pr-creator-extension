export const call_gemini = async (
  { geminiKey, geminiModel },
  prompt,
  system_instruction,
) => {
  const text = `${system_instruction ? "###SYSTEM_INSTRUCTIONS###\n" + system_instruction + "\n\n" : ""}#PROMPT###\n${prompt}`
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${geminiModel}:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text
              },
            ],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  // Parse the JSON response
  const data = await response.json();
  const result = data.candidates?.[0]?.content?.parts?.[0]?.text;

  console.log("Gemini call:", {prompt:text,response:result});
  return result;
};

export async function cleanAsk(
  { geminiModel, geminiKey },
  prompt,
  system_instruction = "",
) {
  try {
    const response = await call_gemini(
      { geminiModel, geminiKey },
      prompt,
      system_instruction,
    );
    if (response) {
      return cleanTripleBacktickString(
        response
      );
    } else {
      throw new Error("No candidates found in response call from Gemini.");
    }
  } catch (error) {
    console.error("Error in cleanCall:", error);
    throw error;
  }
}

export function cleanTripleBacktickString(s) {
  const match = s.match(/```(?:[a-zA-Z0-9]*)\s*([\s\S]*?)\s*```/);
  if (match) {
    let result = match[1];
    if (!result.endsWith("\n")) result += "\n";
    return result;
  }
  return s.endsWith("\n") ? s : s + "\n";
}
