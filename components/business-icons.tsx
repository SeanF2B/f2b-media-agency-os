// Line icon for a business type (Lead Factory ICP profiles), picked from the profile's name and niche.
// More specific words come first so "Bathroom Fitters" gets the bath, not the generic builder icon.
import type { LucideIcon } from "lucide-react";
import {
  Activity, AppWindow, Baby, Bath, Beer, BedDouble, Bone, BookOpen, Brain, Briefcase, Brush, Bug, Building2, Calculator,
  Camera, Car, CarFront, Coffee, Construction, CookingPot, Croissant, Dumbbell, DraftingCompass, Ear, Eye, Fence, Flame,
  Flower, Flower2, Footprints, Glasses, GraduationCap, Hammer, HandHeart, Heart, House, KeyRound, Landmark, Laptop,
  Layers, LayoutGrid, Lock, Megaphone, Music, PaintRoller, PartyPopper, PawPrint, PenTool, Pill, Plane, Scale, Scissors,
  Shield, ShieldCheck, ShoppingBag, Shovel, Smile, Sofa, Sparkles, SprayCan, Stethoscope, Sun, Syringe, Target, Trees,
  Truck, Users, UtensilsCrossed, Warehouse, Wrench, Zap,
} from "lucide-react";

const RULES: Array<[RegExp, LucideIcon]> = [
  [/bathroom/i, Bath], [/kitchen/i, CookingPot], [/window|door/i, AppWindow], [/roof/i, House], [/attic|loft/i, Warehouse],
  [/garden room|garage/i, Trees], [/gate|fenc/i, Fence], [/driveway|paving|landscap|patio/i, Shovel],
  [/heat pump|solar|pv\b/i, Sun], [/insulat|retrofit/i, ShieldCheck], [/stove|fireplace|chimney/i, Flame],
  [/plumb|heating|boiler/i, Wrench], [/electric/i, Zap], [/paint|decorat/i, PaintRoller], [/floor|tiling|tiler/i, LayoutGrid],
  [/plaster|render/i, Layers], [/interior|fit-?out|furnish/i, Sofa], [/handyman|property maint|maintenance/i, Hammer],
  [/extension|builder|construct|renovat/i, Construction], [/clean/i, SprayCan], [/pest/i, Bug], [/locksmith|security/i, Lock],
  [/remov|moving|haulage|courier|logistic/i, Truck],
  [/orthodont|dent/i, Smile], [/chiropract/i, Bone], [/physio|sport/i, Activity], [/podiat|foot/i, Footprints],
  [/hearing|audiolog/i, Ear], [/laser eye|optom|optic/i, Eye], [/glasses|eyewear/i, Glasses], [/fertility|ivf|childcare|creche|nursery/i, Baby],
  [/hair transplant|barber|hair/i, Scissors], [/plastic|cosmetic surg/i, Syringe], [/aesthetic|cosmetic|botox|skin|spa/i, Sparkles],
  [/psycholog|counsel|therap|mental/i, Brain], [/home care|carer|nursing home|elder/i, HandHeart], [/vet|pet|groom/i, PawPrint],
  [/pharmac|chemist/i, Pill], [/gp\b|medical|clinic|doctor|health/i, Stethoscope],
  [/solicitor|lawyer|legal/i, Scale], [/accountant|bookkeep|tax/i, Calculator], [/mortgage|financ|bank|loan/i, Landmark],
  [/insur/i, Shield], [/estate agent|letting|property/i, KeyRound], [/architect|engineer|survey/i, DraftingCompass],
  [/wedding|venue|event/i, PartyPopper], [/photo|video/i, Camera], [/car dealer|detailing|motor/i, CarFront], [/driving school|taxi/i, Car],
  [/mechanic|garage|tyre/i, Wrench], [/tattoo/i, PenTool], [/makeup|beauty|salon|nail|lash|brow/i, Brush],
  [/gym|personal trainer|fitness|pilates|yoga/i, Dumbbell], [/funeral/i, Flower2], [/florist|flower/i, Flower],
  [/restaurant|takeaway|food/i, UtensilsCrossed], [/cafe|coffee/i, Coffee], [/bakery|bakeries|cake/i, Croissant],
  [/pub|bar\b|brewery/i, Beer], [/hotel|b&b|guest ?house|accommodation/i, BedDouble], [/shop|retail|boutique|store/i, ShoppingBag],
  [/school|tutor|college|training/i, GraduationCap], [/library|book/i, BookOpen], [/music|band|dj/i, Music],
  [/travel|tour/i, Plane], [/recruit|staffing/i, Users], [/\bit\b|software|web|tech/i, Laptop], [/marketing|agency|media/i, Megaphone],
  [/dating|matchmak/i, Heart], [/consult|business|b2b/i, Briefcase], [/office|commercial/i, Building2],
];

export function businessIconFor(...texts: Array<string | undefined>): LucideIcon {
  const text = texts.filter(Boolean).join(" ");
  return RULES.find(([pattern]) => pattern.test(text))?.[1] || Target;
}

export function BusinessIcon({ name, niche, color }: { name?: string; niche?: string; color?: string }) {
  const Icon = businessIconFor(name, niche);
  return <Icon size={17} strokeWidth={1.9} color={color} aria-hidden="true" />;
}
