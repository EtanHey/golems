/**
 * Outreach Database - Supabase Backend
 *
 * Same interface as outreach-db.ts but backed by Supabase.
 * Active when STATE_BACKEND=supabase.
 */

import { getSupabase, type SupabaseClient } from "@golems/shared/lib/supabase-factory";
import type {
  Contact,
  ContactSource,
  Outreach,
  OutreachStatus,
  OutreachStats,
  CompanyResearch,
  CompanyResearchData,
  CreateContactInput,
  CreateOutreachInput,
  SaveCompanyResearchInput,
} from "./outreach-db";

function getClient(): SupabaseClient {
  const client = getSupabase();
  if (!client) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY required for cloud outreach-db");
  }
  return client;
}

// ============ Contact Functions ============

/** Create a new contact in Supabase */
export async function createContact(input: CreateContactInput): Promise<Contact> {
  const { data, error } = await getClient()
    .from("outreach_contacts")
    .insert({
      name: input.name,
      email: input.email || null,
      linkedin_url: input.linkedinUrl || null,
      company: input.company,
      role: input.role,
      source: input.source,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create contact: ${error?.message}`);

  return mapContact(data);
}

/** Get a contact by ID from Supabase */
export async function getContact(id: string): Promise<Contact | null> {
  const { data } = await getClient()
    .from("outreach_contacts")
    .select("*")
    .eq("id", id)
    .single();

  return data ? mapContact(data) : null;
}

/** Get all contacts for a company from Supabase */
export async function getContactsByCompany(company: string): Promise<Contact[]> {
  const { data } = await getClient()
    .from("outreach_contacts")
    .select("*")
    .eq("company", company)
    .order("created_at", { ascending: false });

  return (data || []).map(mapContact);
}

// ============ Outreach Functions ============

/** Create a new outreach message in Supabase */
export async function createOutreach(input: CreateOutreachInput): Promise<Outreach> {
  const { data, error } = await getClient()
    .from("outreach_messages")
    .insert({
      job_id: input.jobId,
      contact_id: input.contactId,
      message_type: input.messageType,
      message_text: input.messageText,
      status: "draft",
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create outreach: ${error?.message}`);

  return mapOutreach(data);
}

/** Get an outreach message by ID from Supabase */
export async function getOutreach(id: string): Promise<Outreach | null> {
  const { data } = await getClient()
    .from("outreach_messages")
    .select("*")
    .eq("id", id)
    .single();

  return data ? mapOutreach(data) : null;
}

/** Get all outreach messages for a job from Supabase */
export async function getOutreachByJob(jobId: string): Promise<Outreach[]> {
  const { data } = await getClient()
    .from("outreach_messages")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  return (data || []).map(mapOutreach);
}

/** Update outreach message status in Supabase */
export async function updateOutreachStatus(id: string, status: OutreachStatus): Promise<Outreach> {
  const updates: Record<string, unknown> = { status };
  const now = new Date().toISOString();

  if (status === "sent") updates.sent_at = now;
  if (status === "responded") updates.sent_at = updates.sent_at || now;

  const { error } = await getClient()
    .from("outreach_messages")
    .update(updates)
    .eq("id", id);

  if (error) throw new Error(`Failed to update outreach: ${error.message}`);

  return (await getOutreach(id))!;
}

/** Get outreach messages sent more than N days ago with no response */
export async function getPendingFollowups(daysOld: number = 5): Promise<Outreach[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  const { data } = await getClient()
    .from("outreach_messages")
    .select("*")
    .eq("status", "sent")
    .lt("sent_at", cutoff.toISOString())
    .order("sent_at", { ascending: true });

  return (data || []).map(mapOutreach);
}

/** Get aggregated outreach statistics from Supabase */
export async function getOutreachStats(): Promise<OutreachStats> {
  const { data } = await getClient()
    .from("outreach_messages")
    .select("status");

  const rows = data || [];
  const total = rows.length;
  const draft = rows.filter((r) => r.status === "draft").length;
  const sent = rows.filter((r) => r.status === "sent").length;
  const responded = rows.filter((r) => r.status === "responded").length;
  const noResponse = rows.filter((r) => r.status === "no_response").length;

  const nonDraft = sent + responded + noResponse;
  const responseRate = nonDraft > 0 ? (responded / nonDraft) * 100 : 0;

  return {
    total,
    draft,
    sent,
    responded,
    noResponse,
    responseRate: Math.round(responseRate * 100) / 100,
  };
}

// ============ Company Research ============

/** Save or update company research in Supabase (upsert by company name) */
export async function saveCompanyResearch(input: SaveCompanyResearchInput): Promise<CompanyResearch> {
  const { data, error } = await getClient()
    .from("outreach_companies")
    .upsert({
      company_name: input.companyName,
      data: input.data,
      researched_at: new Date().toISOString(),
    }, { onConflict: "company_name" })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to save company research: ${error?.message}`);

  return {
    id: data.id,
    companyName: data.company_name,
    data: data.data as CompanyResearchData,
    researchedAt: data.researched_at,
  };
}

/** Get company research by name from Supabase */
export async function getCompanyResearch(companyName: string): Promise<CompanyResearch | null> {
  const { data } = await getClient()
    .from("outreach_companies")
    .select("*")
    .eq("company_name", companyName)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    companyName: data.company_name,
    data: data.data as CompanyResearchData,
    researchedAt: data.researched_at,
  };
}

// ============ Mappers ============

function mapContact(row: any): Contact {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    linkedinUrl: row.linkedin_url,
    company: row.company,
    role: row.role,
    source: row.source as ContactSource,
    createdAt: row.created_at,
  };
}

function mapOutreach(row: any): Outreach {
  return {
    id: row.id,
    jobId: row.job_id,
    contactId: row.contact_id,
    messageType: row.message_type,
    messageText: row.message_text,
    status: row.status as OutreachStatus,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    respondedAt: null, // outreach_messages table doesn't have responded_at
  };
}
