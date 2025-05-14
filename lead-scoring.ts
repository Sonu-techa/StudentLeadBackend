import { Lead } from "@shared/schema";
import { LeadScore } from "@shared/types";

type LeadSource = 'website' | 'landing_page' | 'facebook' | 'instagram' | 'twitter' | 'whatsapp' | 'telegram' | 'college' | 'referral' | 'other';
type LeadStatus = 'new' | 'contacted' | 'qualified' | 'not_qualified';

// Tier 1 states (major economical centers)
const tier1States = ['Maharashtra', 'Delhi', 'Karnataka', 'Tamil Nadu', 'Telangana', 'Gujarat'];

// Tier 2 states (growing economical centers)
const tier2States = ['Haryana', 'Uttar Pradesh', 'West Bengal', 'Kerala', 'Rajasthan', 'Punjab'];

/**
 * Get state tier score based on the state name
 * @param state The state name
 * @returns The state tier score
 */
function getStateTierScore(state: string | null | undefined): number {
  if (!state) return 0;
  
  const normalizedState = state.trim().toLowerCase();
  
  // Check for Tier 1 states
  if (tier1States.some(s => s.toLowerCase() === normalizedState)) {
    return 20;
  }
  
  // Check for Tier 2 states
  if (tier2States.some(s => s.toLowerCase() === normalizedState)) {
    return 10;
  }
  
  // Default for other states
  return 5;
}

/**
 * Get recency score based on creation date
 * @param createdAt The date when the lead was created
 * @returns The recency score
 */
function getRecencyScore(createdAt: Date | null | undefined): number {
  if (!createdAt) return 0;
  
  const now = new Date();
  const leadDate = new Date(createdAt);
  const daysDifference = Math.floor((now.getTime() - leadDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // Score based on recency
  if (daysDifference <= 1) return 20; // Today or yesterday
  if (daysDifference <= 3) return 15; // Last 3 days
  if (daysDifference <= 7) return 10; // Last week
  if (daysDifference <= 30) return 5; // Last month
  
  return 2; // Older than a month
}

/**
 * Get education level score
 * @param education The education level
 * @returns The education score
 */
function getEducationScore(education: string | null | undefined): number {
  if (!education) return 0;
  
  const normalizedEducation = education.trim().toLowerCase();
  
  // Score based on education level
  if (normalizedEducation.includes('post graduate') || normalizedEducation.includes('pg') || normalizedEducation.includes('masters') || normalizedEducation.includes('mba')) {
    return 20;
  }
  
  if (normalizedEducation.includes('graduate') || normalizedEducation.includes('bachelors') || normalizedEducation.includes('btech') || normalizedEducation.includes('bba')) {
    return 15;
  }
  
  if (normalizedEducation.includes('12th') || normalizedEducation.includes('senior secondary') || normalizedEducation.includes('higher secondary')) {
    return 10;
  }
  
  if (normalizedEducation.includes('10th') || normalizedEducation.includes('secondary')) {
    return 5;
  }
  
  return 2; // Other education levels
}

/**
 * Get age score from age string
 * @param age The age string
 * @returns The age score
 */
function getAgeScore(age: string | null | undefined): number {
  if (!age) return 0;
  
  // Extract number from age string
  const ageNum = parseInt(age.replace(/[^\d]/g, ''));
  
  if (isNaN(ageNum)) return 0;
  
  // Score based on age
  if (ageNum >= 22 && ageNum <= 30) return 20; // Ideal age for work from home jobs
  if (ageNum >= 18 && ageNum <= 21) return 15; // College students
  if (ageNum >= 31 && ageNum <= 40) return 10; // Experienced professionals
  if (ageNum >= 41 && ageNum <= 50) return 5;  // Mid-career professionals
  
  return 2; // Other age groups
}

/**
 * Get source score based on lead source
 * @param source The lead source
 * @returns The source score
 */
function getSourceScore(source: string | null | undefined): number {
  if (!source) return 0;
  
  // Score based on lead source
  switch (source.toLowerCase()) {
    case 'website':
      return 20;
    case 'landing_page':
      return 18;
    case 'referral':
      return 15;
    case 'facebook':
    case 'instagram':
      return 12;
    case 'whatsapp':
    case 'telegram':
      return 10;
    case 'twitter':
      return 8;
    case 'college':
      return 10;
    default:
      return 5;
  }
}

/**
 * Calculate lead score based on various factors
 * @param lead The lead to score
 * @returns Object with score and breakdown
 */
export function scoreLead(lead: Lead): LeadScore {
  const breakdown: Record<string, number> = {};
  
  // State/location score
  const stateTierScore = getStateTierScore(lead.state);
  breakdown.location = stateTierScore;
  
  // Recency score
  const recencyScore = getRecencyScore(lead.createdAt);
  breakdown.recency = recencyScore;
  
  // Education score
  const educationScore = getEducationScore(lead.education);
  breakdown.education = educationScore;
  
  // Age score
  const ageScore = getAgeScore(lead.age);
  breakdown.age = ageScore;
  
  // Source score
  const sourceScore = getSourceScore(lead.source);
  breakdown.source = sourceScore;
  
  // Calculate total score
  const totalScore = stateTierScore + recencyScore + educationScore + ageScore + sourceScore;
  
  // Determine lead quality based on score
  let label = '';
  if (totalScore >= 70) {
    label = 'Hot';
  } else if (totalScore >= 50) {
    label = 'Warm';
  } else {
    label = 'Cold';
  }
  
  return {
    score: totalScore,
    breakdown,
    label
  };
}

/**
 * Batch score multiple leads
 * @param leads Array of leads to score
 * @returns Array of leads with scores
 */
export function batchScoreLeads(leads: Lead[]): Array<Lead & { 
  score: number;
  scoreLabel: string;
}> {
  return leads.map(lead => {
    const { score, label } = scoreLead(lead);
    return {
      ...lead,
      score,
      scoreLabel: label
    };
  });
}