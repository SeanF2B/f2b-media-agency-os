const blockStyle = {
  type: "object",
  additionalProperties: false,
  properties: {
    backgroundColor: { type: "string" },
    textColor: { type: "string" },
    padding: { type: "string", enum: ["compact", "comfortable", "spacious"] },
    alignment: { type: "string", enum: ["left", "center", "right"] },
    imageFit: { type: "string", enum: ["cover", "contain"] },
    imageAspect: { type: "string", enum: ["auto", "landscape", "square", "portrait"] },
    imagePosition: { type: "string", enum: ["center", "top", "bottom", "left", "right", "top left", "top right", "bottom left", "bottom right"] },
  },
  required: ["backgroundColor", "textColor", "padding", "alignment", "imageFit", "imageAspect", "imagePosition"],
};

export const marketingAiVisualSchema = {
  blockStyle,
  design: {
    type: "object",
    additionalProperties: false,
    properties: {
      brandColor: { type: "string" },
      backgroundColor: { type: "string" },
      textColor: { type: "string" },
      fontFamily: { type: "string", enum: ["system", "sans", "serif", "rounded"] },
      contentWidth: { type: "number" },
    },
    required: ["brandColor", "backgroundColor", "textColor", "fontFamily", "contentWidth"],
  },
};
