const field = (id, label, type, required = false) => ({ id, label, type, required, options: [] });

const templates = {
  service_enquiry: {
    heading: "Tell us what you need",
    description: "Share a few details about your project and the team can follow up.",
    seoTitle: "Service enquiry",
    seoDescription: "Send an enquiry about the service you need.",
    submitLabel: "Send enquiry",
    sections: [
      { type: "hero", heading: "A clear next step for your project", body: "Replace this with a concise explanation of your service and who it helps.", buttonLabel: "Make an enquiry", buttonUrl: "" },
      { type: "columns", heading: "What happens next", body: "", layout: "three-column", columns: [{ heading: "Tell us about it", body: "Describe the first step in your enquiry process." }, { heading: "Review the details", body: "Explain how your team evaluates a new enquiry." }, { heading: "Plan together", body: "Set a realistic expectation for the next conversation." }] },
      { type: "faq", heading: "Common questions", body: "Add answers to the questions customers ask before getting in touch." },
    ],
    funnelSteps: [{ title: "Overview", heading: "A clear next step for your project", body: "Replace this with a concise explanation of your service." }, { title: "Your enquiry", heading: "Tell us what you need", body: "Share your details so the team can follow up." }],
    fields: [field("name", "Your name", "text", true), field("email", "Email address", "email", true), field("phone", "Phone number", "tel"), field("project", "How can we help?", "textarea", true)],
  },
  quote_request: {
    heading: "Request a project estimate",
    description: "Tell us about the work so the team can review the scope before discussing pricing.",
    seoTitle: "Request an estimate",
    seoDescription: "Share project details to request an estimate.",
    submitLabel: "Request estimate",
    sections: [
      { type: "hero", heading: "Get your project scoped", body: "Describe the work, what is included and any details needed to prepare an estimate.", buttonLabel: "Start your request", buttonUrl: "" },
      { type: "text", heading: "Help us understand the project", body: "List the measurements, materials or constraints you need customers to provide. Add only the details relevant to your business." },
      { type: "faq", heading: "Before you request an estimate", body: "Explain what the estimate includes and what information may change the final price." },
    ],
    funnelSteps: [{ title: "Project scope", heading: "Get your project scoped", body: "Share the details needed to review the work." }, { title: "Contact details", heading: "Where should we send the response?", body: "Provide the best way for the team to contact you." }],
    fields: [field("name", "Your name", "text", true), field("email", "Email address", "email", true), field("phone", "Phone number", "tel"), field("project", "Describe the work", "textarea", true)],
  },
  appointment_enquiry: {
    heading: "Ask about an appointment",
    description: "Send your preferred time and the team can confirm availability.",
    seoTitle: "Appointment enquiry",
    seoDescription: "Ask the team to arrange an appointment.",
    submitLabel: "Request a time",
    sections: [
      { type: "hero", heading: "Find a time that suits", body: "Explain what the appointment covers and how availability is confirmed.", buttonLabel: "Choose a preferred time", buttonUrl: "" },
      { type: "text", heading: "What to expect", body: "Add the appointment length, preparation details and any relevant service information." },
      { type: "faq", heading: "Appointment questions", body: "Add your cancellation, rescheduling and availability information." },
    ],
    funnelSteps: [{ title: "Appointment details", heading: "Find a time that suits", body: "Tell us what the appointment is for and when you prefer." }, { title: "Contact details", heading: "Where can we reach you?", body: "The team will confirm the appointment after checking availability." }],
    fields: [field("name", "Your name", "text", true), field("email", "Email address", "email", true), field("preferred_date", "Preferred date", "date", true), { ...field("preferred_time", "Preferred time", "select", true), options: [{ label: "Morning", value: "morning" }, { label: "Afternoon", value: "afternoon" }, { label: "No preference", value: "no_preference" }] }],
  },
};

export function getMarketingFunnelTemplateIds() {
  return Object.keys(templates);
}

export function createMarketingFunnelTemplate(templateId) {
  const template = templates[templateId];
  if (!template) return null;
  return structuredClone({
    ...template,
    canonicalUrl: "",
    ogImageUrl: "",
    noIndex: false,
    fixedFee: 0,
    minimumCharge: 0,
    percentageAdjustmentPercent: 0,
    discountPercent: 0,
    taxPercent: 0,
    currency: "EUR",
    allowedDomains: [],
    nodes: [],
  });
}
