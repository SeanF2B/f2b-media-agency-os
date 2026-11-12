const textField = (id, label, type = "text", required = false, extra = {}) => ({ id, label, type, required, options: [], ...extra });

const templates = {
  form: {
    service_enquiry: {
      name: "Service enquiry",
      draft: {
        heading: "Tell us what you need",
        description: "Share a few details and the team can follow up.",
        submitLabel: "Send enquiry",
        fields: [textField("name", "Your name", "text", true), textField("email", "Email address", "email", true), textField("phone", "Phone number", "tel"), textField("service", "What service are you interested in?", "select", true, { options: [{ label: "Choose a service", value: "", price: 0 }, { label: "Service option 1", value: "service-1", price: 0 }, { label: "Service option 2", value: "service-2", price: 0 }] }), textField("details", "Anything else we should know?", "textarea")],
      },
    },
    quote_request: {
      name: "Quote request",
      draft: {
        heading: "Request a quote",
        description: "Tell us a little about the project. We will review the details and get back to you.",
        submitLabel: "Request my quote",
        fields: [textField("name", "Your name", "text", true), textField("email", "Email address", "email", true), textField("phone", "Phone number", "tel", true), textField("address", "Project address", "address"), textField("project", "Describe the project", "textarea", true)],
      },
    },
  },
  survey: {
    project_discovery: {
      name: "Project discovery",
      draft: {
        heading: "Tell us about your project",
        description: "A few questions help us understand what you are looking for.",
        submitLabel: "Finish",
        fields: [textField("project-type", "What kind of project is this?", "radio", true, { step: 1, options: [{ label: "Option 1", value: "option-1" }, { label: "Option 2", value: "option-2" }] }), textField("timing", "When are you hoping to start?", "select", true, { step: 2, options: [{ label: "As soon as possible", value: "soon" }, { label: "Within a few months", value: "few-months" }, { label: "Just researching", value: "researching" }] }), textField("details", "What else should we know?", "textarea", false, { step: 2 }), textField("name", "Your name", "text", true, { step: 3 }), textField("email", "Email address", "email", true, { step: 3 })],
      },
    },
    feedback: {
      name: "Customer feedback",
      draft: {
        heading: "Share your feedback",
        description: "Your answers help us understand your experience.",
        submitLabel: "Submit feedback",
        fields: [textField("rating", "How would you rate your experience?", "radio", true, { step: 1, options: [{ label: "Very good", value: "very-good" }, { label: "Good", value: "good" }, { label: "Okay", value: "okay" }, { label: "Needs improvement", value: "needs-improvement" }] }), textField("comments", "What could we improve?", "textarea", false, { step: 2 }), textField("email", "Email address (optional)", "email", false, { step: 2 })],
      },
    },
  },
  calculator: {
    quantity_estimate: {
      name: "Quantity estimate",
      draft: {
        heading: "Estimate your project",
        description: "Enter the project quantity for an indicative estimate. Add and confirm your own rates before publishing.",
        submitLabel: "Request estimate",
        fields: [textField("quantity", "Quantity", "number", true, { min: 0, unitLabel: "units", pricePerUnit: 0 }), textField("extras", "Optional extras", "multiselect", false, { options: [{ label: "Extra 1", value: "extra-1", price: 0 }, { label: "Extra 2", value: "extra-2", price: 0 }] }), textField("name", "Your name", "text", true), textField("email", "Email address", "email", true)],
      },
    },
    area_estimate: {
      name: "Area estimate",
      draft: {
        heading: "Estimate by area",
        description: "Enter the dimensions for an indicative area estimate. Confirm your rate and any exclusions before publishing.",
        submitLabel: "Request estimate",
        fields: [textField("length", "Length", "number", true, { min: 0, unitLabel: "m", pricePerUnit: 0 }), textField("width", "Width", "number", true, { min: 0, unitLabel: "m", pricePerUnit: 0 }), textField("area", "Area", "calculated", false, { unitLabel: "m²", pricePerUnit: 0, calculation: { operation: "multiply", fieldIds: ["length", "width"] } }), textField("name", "Your name", "text", true), textField("email", "Email address", "email", true)],
      },
    },
  },
  automation: {
    form_task_followup: {
      name: "Form enquiry task",
      draft: {
        heading: "New form enquiry follow-up",
        description: "Internal task only. Choose a published form and assign task ownership before activation.",
        nodes: [{ id: "trigger", type: "trigger", label: "Form submitted", config: JSON.stringify({ event: "form_submitted", assetSlug: "" }) }, { id: "task", type: "task", label: "Review new enquiry", config: "Review the new form enquiry and follow up" }],
      },
    },
    survey_task_review: {
      name: "Survey response review",
      draft: {
        heading: "Review survey response",
        description: "Internal task only. Choose a published survey and assign task ownership before activation.",
        nodes: [{ id: "trigger", type: "trigger", label: "Survey completed", config: JSON.stringify({ event: "survey_completed", assetSlug: "" }) }, { id: "task", type: "task", label: "Review survey response", config: "Review the completed survey response" }],
      },
    },
  },
};

export function getMarketingProjectTemplateIds(kind) {
  return Object.keys(templates[kind] || {});
}

export function getMarketingProjectTemplateName(kind, id) {
  return templates[kind]?.[id]?.name || "";
}

export function createMarketingProjectTemplate(kind, id) {
  const template = templates[kind]?.[id];
  if (!template) return null;
  return structuredClone(template.draft);
}

export function createMarketingBlankProject(kind, currentDraft) {
  if (!templates[kind] || !currentDraft || typeof currentDraft !== "object") return null;
  return {
    ...structuredClone(currentDraft),
    heading: "", description: "", seoTitle: "", seoDescription: "", canonicalUrl: "", ogImageUrl: "", noIndex: false, submitLabel: "",
    fixedFee: 0, minimumCharge: 0, discountPercent: 0, taxPercent: 0,
    fields: [], sections: [], funnelSteps: [],
    nodes: kind === "automation" ? [{ id: "trigger", type: "trigger", label: "Choose a trigger", config: "" }] : [],
  };
}
