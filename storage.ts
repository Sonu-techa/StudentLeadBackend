import { db } from './db';
import { users, leads, forms, campaigns, adPosts, leadExports } from '@shared/schema';
import { eq, desc, and, like, gte, lte, sql, count, isNull, not } from 'drizzle-orm';
import { PaginatedResponse, LeadFilters, CampaignFilters, LeadSourcesStat, DashboardStats, CampaignPerformance, SocialPlatform } from '@shared/types';
import { User, InsertUser, Lead, InsertLead, LeadUpdate, Form, FormInsert, Campaign, CampaignInsert, AdPost, AdPostInsert, LeadExport, InsertLeadExport } from '@shared/schema';
import connectPg from "connect-pg-simple";
import session from "express-session";
import { pool } from './db';
import { scoreLead } from './lead-scoring';

// Create PostgreSQL session store
const PostgresSessionStore = connectPg(session);
// Use in-memory session store to avoid session table issues
// This is a workaround for session_pkey already exists error
const MemoryStore = session.MemoryStore;
const sessionStore = new MemoryStore();

// Storage interface for our application
export const storage = {
  // Session storage
  sessionStore,

  // User methods
  async getUser(id: number): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      return user || undefined;
    } catch (error) {
      console.error("Error getting user:", error);
      return undefined;
    }
  },

  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.username, username));
      return user || undefined;
    } catch (error) {
      console.error("Error getting user by username:", error);
      return undefined;
    }
  },

  async createUser(userData: InsertUser): Promise<User> {
    try {
      const [user] = await db.insert(users).values(userData).returning();
      return user;
    } catch (error) {
      console.error("Error creating user:", error);
      throw new Error("Failed to create user");
    }
  },

  // Lead methods
  async getLeadById(id: number): Promise<Lead | null> {
    try {
      const [lead] = await db.select().from(leads).where(eq(leads.id, id));
      return lead || null;
    } catch (error) {
      console.error("Error getting lead:", error);
      return null;
    }
  },

  async getAllLeads(filters: LeadFilters = {}): Promise<PaginatedResponse<Lead>> {
    try {
      const { page = 1, perPage = 10, sortBy = 'createdAt', sortOrder = 'desc', search, source, status, dateRange } = filters;
      
      // Build filter conditions
      const conditions = [];
      
      if (search) {
        conditions.push(like(leads.fullName, `%${search}%`));
      }
      
      if (source) {
        conditions.push(eq(leads.source, source));
      }
      
      if (status) {
        conditions.push(eq(leads.status, status));
      }
      
      if (dateRange?.from) {
        conditions.push(gte(leads.createdAt, new Date(dateRange.from)));
      }
      
      if (dateRange?.to) {
        conditions.push(lte(leads.createdAt, new Date(dateRange.to)));
      }

      // Query with filters
      const filter = conditions.length > 0 ? and(...conditions) : undefined;

      // Count total items
      const [{ value: totalItems }] = await db
        .select({ value: count() })
        .from(leads)
        .where(filter);

      // Get paginated data
      const data = await db
        .select()
        .from(leads)
        .where(filter)
        .orderBy(sortOrder === 'desc' ? desc(leads[sortBy as keyof typeof leads]) : leads[sortBy as keyof typeof leads])
        .limit(perPage)
        .offset((page - 1) * perPage);

      // Calculate scores for leads
      const leadsWithScores = data.map(lead => {
        const { score, label } = scoreLead(lead);
        return { ...lead, score, scoreLabel: label };
      });

      return {
        data: leadsWithScores,
        meta: {
          currentPage: page,
          totalPages: Math.ceil(totalItems / perPage),
          totalItems,
          itemsPerPage: perPage,
        },
      };
    } catch (error) {
      console.error("Error getting leads:", error);
      return {
        data: [],
        meta: {
          currentPage: 1,
          totalPages: 0,
          totalItems: 0,
          itemsPerPage: 10,
        },
      };
    }
  },

  async getRecentLeads(limit: number = 5): Promise<Lead[]> {
    try {
      const recentLeads = await db
        .select()
        .from(leads)
        .orderBy(desc(leads.createdAt))
        .limit(limit);
      
      return recentLeads;
    } catch (error) {
      console.error("Error getting recent leads:", error);
      return [];
    }
  },

  async createLead(lead: InsertLead): Promise<Lead> {
    try {
      const [newLead] = await db.insert(leads).values(lead).returning();
      return newLead;
    } catch (error) {
      console.error("Error creating lead:", error);
      throw new Error("Failed to create lead");
    }
  },

  async updateLead(id: number, data: Partial<LeadUpdate>): Promise<Lead | null> {
    try {
      const [updatedLead] = await db
        .update(leads)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(leads.id, id))
        .returning();
      
      return updatedLead || null;
    } catch (error) {
      console.error("Error updating lead:", error);
      return null;
    }
  },

  async deleteLead(id: number): Promise<boolean> {
    try {
      const [deletedLead] = await db
        .delete(leads)
        .where(eq(leads.id, id))
        .returning();
      
      return !!deletedLead;
    } catch (error) {
      console.error("Error deleting lead:", error);
      return false;
    }
  },

  // Dashboard methods
  async getDashboardStats(): Promise<DashboardStats> {
    try {
      // Get total leads
      const [{ value: totalLeads }] = await db
        .select({ value: count() })
        .from(leads);

      // Get new leads today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const [{ value: newLeadsToday }] = await db
        .select({ value: count() })
        .from(leads)
        .where(gte(leads.createdAt, today));

      // Get total active forms
      const [{ value: activeForms }] = await db
        .select({ value: count() })
        .from(forms)
        .where(eq(forms.active, true));

      // Calculate growth stats (placeholder for now)
      // In a real app, you would compare with previous periods
      const leadGrowth = "+15%";
      const dailyGrowth = "+5%";
      const conversionRate = "12%";
      const conversionTrend = "+2%";
      const formStatus = "Active";

      return {
        totalLeads,
        newLeadsToday,
        leadGrowth,
        dailyGrowth,
        conversionRate,
        conversionTrend,
        activeForms,
        formStatus,
      };
    } catch (error) {
      console.error("Error getting dashboard stats:", error);
      return {
        totalLeads: 0,
        newLeadsToday: 0,
        leadGrowth: "+0%",
        dailyGrowth: "+0%",
        conversionRate: "0%",
        conversionTrend: "+0%",
        activeForms: 0,
        formStatus: "Unknown",
      };
    }
  },

  async getLeadSourcesStats(): Promise<LeadSourcesStat[]> {
    try {
      const sourceCounts = await db
        .select({
          source: leads.source,
          count: count(),
        })
        .from(leads)
        .groupBy(leads.source);

      // Calculate total for percentages
      const totalLeads = sourceCounts.reduce((sum, { count }) => sum + Number(count), 0);

      // Calculate percentages
      return sourceCounts.map(({ source, count }) => ({
        source,
        count: Number(count),
        percentage: totalLeads > 0 ? Math.round((Number(count) / totalLeads) * 100) : 0,
      }));
    } catch (error) {
      console.error("Error getting lead source stats:", error);
      return [];
    }
  },

  // Form methods
  async getAllForms(): Promise<Form[]> {
    try {
      const forms_list = await db
        .select()
        .from(forms)
        .orderBy(desc(forms.createdAt));
      
      return forms_list;
    } catch (error) {
      console.error("Error getting forms:", error);
      return [];
    }
  },

  async getFormById(id: number): Promise<Form | null> {
    try {
      const [form] = await db
        .select()
        .from(forms)
        .where(eq(forms.id, id));
      
      return form || null;
    } catch (error) {
      console.error("Error getting form:", error);
      return null;
    }
  },

  async createForm(form: FormInsert): Promise<Form> {
    try {
      const [newForm] = await db
        .insert(forms)
        .values(form)
        .returning();
      
      return newForm;
    } catch (error) {
      console.error("Error creating form:", error);
      throw new Error("Failed to create form");
    }
  },

  async updateForm(id: number, data: Partial<FormInsert>): Promise<Form | null> {
    try {
      const [updatedForm] = await db
        .update(forms)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(forms.id, id))
        .returning();
      
      return updatedForm || null;
    } catch (error) {
      console.error("Error updating form:", error);
      return null;
    }
  },

  async deleteForm(id: number): Promise<boolean> {
    try {
      const [deletedForm] = await db
        .delete(forms)
        .where(eq(forms.id, id))
        .returning();
      
      return !!deletedForm;
    } catch (error) {
      console.error("Error deleting form:", error);
      return false;
    }
  },

  // Campaign methods
  async getAllCampaigns(filters: CampaignFilters = {}): Promise<PaginatedResponse<Campaign>> {
    try {
      const { page = 1, perPage = 10, sortBy = 'createdAt', sortOrder = 'desc', search, status, dateRange } = filters;
      
      // Build filter conditions
      const conditions = [];
      
      if (search) {
        conditions.push(like(campaigns.name, `%${search}%`));
      }
      
      if (status) {
        conditions.push(eq(campaigns.status, status));
      }
      
      if (dateRange?.from) {
        conditions.push(gte(campaigns.startDate, new Date(dateRange.from)));
      }
      
      if (dateRange?.to) {
        if (dateRange.to) {
          conditions.push(lte(campaigns.startDate, new Date(dateRange.to)));
        }
      }

      // Query with filters
      const filter = conditions.length > 0 ? and(...conditions) : undefined;

      // Count total items
      const [{ value: totalItems }] = await db
        .select({ value: count() })
        .from(campaigns)
        .where(filter);

      // Get paginated data
      const data = await db
        .select()
        .from(campaigns)
        .where(filter)
        .orderBy(sortOrder === 'desc' ? desc(campaigns[sortBy as keyof typeof campaigns]) : campaigns[sortBy as keyof typeof campaigns])
        .limit(perPage)
        .offset((page - 1) * perPage);

      return {
        data,
        meta: {
          currentPage: page,
          totalPages: Math.ceil(totalItems / perPage),
          totalItems,
          itemsPerPage: perPage,
        },
      };
    } catch (error) {
      console.error("Error getting campaigns:", error);
      return {
        data: [],
        meta: {
          currentPage: 1,
          totalPages: 0,
          totalItems: 0,
          itemsPerPage: 10,
        },
      };
    }
  },

  async getCampaignById(id: number): Promise<Campaign | null> {
    try {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, id));
      
      return campaign || null;
    } catch (error) {
      console.error("Error getting campaign:", error);
      return null;
    }
  },

  async getActiveCampaign(): Promise<Campaign | null> {
    try {
      const [activeCampaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.status, 'active'));
      
      return activeCampaign || null;
    } catch (error) {
      console.error("Error getting active campaign:", error);
      return null;
    }
  },

  async createCampaign(campaign: CampaignInsert): Promise<Campaign> {
    try {
      const [newCampaign] = await db
        .insert(campaigns)
        .values(campaign)
        .returning();
      
      return newCampaign;
    } catch (error) {
      console.error("Error creating campaign:", error);
      throw new Error("Failed to create campaign");
    }
  },

  async updateCampaign(id: number, data: Partial<CampaignInsert>): Promise<Campaign | null> {
    try {
      const [updatedCampaign] = await db
        .update(campaigns)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(campaigns.id, id))
        .returning();
      
      return updatedCampaign || null;
    } catch (error) {
      console.error("Error updating campaign:", error);
      return null;
    }
  },

  async deleteCampaign(id: number): Promise<boolean> {
    try {
      // Delete related ad posts first
      await db
        .delete(adPosts)
        .where(eq(adPosts.campaignId, id));
      
      // Then delete the campaign
      const [deletedCampaign] = await db
        .delete(campaigns)
        .where(eq(campaigns.id, id))
        .returning();
      
      return !!deletedCampaign;
    } catch (error) {
      console.error("Error deleting campaign:", error);
      return false;
    }
  },

  // Ad post methods
  async getAllAdPosts(campaignId?: number): Promise<AdPost[]> {
    try {
      if (campaignId) {
        return db
          .select()
          .from(adPosts)
          .where(eq(adPosts.campaignId, campaignId))
          .orderBy(desc(adPosts.createdAt));
      } else {
        return db
          .select()
          .from(adPosts)
          .orderBy(desc(adPosts.createdAt));
      }
    } catch (error) {
      console.error("Error getting ad posts:", error);
      return [];
    }
  },

  async getAdPostById(id: number): Promise<AdPost | null> {
    try {
      const [adPost] = await db
        .select()
        .from(adPosts)
        .where(eq(adPosts.id, id));
      
      return adPost || null;
    } catch (error) {
      console.error("Error getting ad post:", error);
      return null;
    }
  },

  async createAdPost(adPost: AdPostInsert): Promise<AdPost> {
    try {
      const [newAdPost] = await db
        .insert(adPosts)
        .values(adPost)
        .returning();
      
      return newAdPost;
    } catch (error) {
      console.error("Error creating ad post:", error);
      throw new Error("Failed to create ad post");
    }
  },

  async updateAdPost(id: number, data: Partial<AdPostInsert>): Promise<AdPost | null> {
    try {
      const [updatedAdPost] = await db
        .update(adPosts)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(adPosts.id, id))
        .returning();
      
      return updatedAdPost || null;
    } catch (error) {
      console.error("Error updating ad post:", error);
      return null;
    }
  },

  async updateAdPostStats(id: number, impressions: number, clicks: number, leadsCaptured: number): Promise<AdPost | null> {
    try {
      const [updatedAdPost] = await db
        .update(adPosts)
        .set({ 
          impressions, 
          clicks, 
          leadsCaptured,
          updatedAt: new Date() 
        })
        .where(eq(adPosts.id, id))
        .returning();
      
      return updatedAdPost || null;
    } catch (error) {
      console.error("Error updating ad post stats:", error);
      return null;
    }
  },

  async deleteAdPost(id: number): Promise<boolean> {
    try {
      const [deletedAdPost] = await db
        .delete(adPosts)
        .where(eq(adPosts.id, id))
        .returning();
      
      return !!deletedAdPost;
    } catch (error) {
      console.error("Error deleting ad post:", error);
      return false;
    }
  },

  async getCampaignPerformance(campaignId: number): Promise<CampaignPerformance | null> {
    try {
      // Get campaign
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign) {
        return null;
      }

      // Get ad posts for the campaign
      const posts = await this.getAllAdPosts(campaignId);
      if (!posts.length) {
        return {
          campaign,
          totalPosts: 0,
          totalImpressions: 0,
          totalClicks: 0,
          totalLeads: 0,
          ctr: 0,
          conversionRate: 0,
          platformBreakdown: {
            facebook: {
              impressions: 0,
              clicks: 0,
              leadsCaptured: 0,
              ctr: 0,
              conversionRate: 0
            },
            instagram: {
              impressions: 0,
              clicks: 0,
              leadsCaptured: 0,
              ctr: 0,
              conversionRate: 0
            },
            twitter: {
              impressions: 0,
              clicks: 0,
              leadsCaptured: 0,
              ctr: 0,
              conversionRate: 0
            },
            whatsapp: {
              impressions: 0,
              clicks: 0,
              leadsCaptured: 0,
              ctr: 0,
              conversionRate: 0
            },
            telegram: {
              impressions: 0,
              clicks: 0,
              leadsCaptured: 0,
              ctr: 0,
              conversionRate: 0
            }
          }
        };
      }

      // Calculate total metrics
      const totalImpressions = posts.reduce((sum, post) => sum + post.impressions, 0);
      const totalClicks = posts.reduce((sum, post) => sum + post.clicks, 0);
      const totalLeads = posts.reduce((sum, post) => sum + post.leadsCaptured, 0);
      
      // Calculate rates
      const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      const conversionRate = totalClicks > 0 ? (totalLeads / totalClicks) * 100 : 0;

      // Calculate platform breakdown
      const platformBreakdown: Record<SocialPlatform, AdPostAnalytics> = {
        facebook: { impressions: 0, clicks: 0, leadsCaptured: 0, ctr: 0, conversionRate: 0 },
        instagram: { impressions: 0, clicks: 0, leadsCaptured: 0, ctr: 0, conversionRate: 0 },
        twitter: { impressions: 0, clicks: 0, leadsCaptured: 0, ctr: 0, conversionRate: 0 },
        whatsapp: { impressions: 0, clicks: 0, leadsCaptured: 0, ctr: 0, conversionRate: 0 },
        telegram: { impressions: 0, clicks: 0, leadsCaptured: 0, ctr: 0, conversionRate: 0 }
      };

      // Process each platform
      posts.forEach(post => {
        const platform = post.platform as SocialPlatform;
        if (platform && platformBreakdown[platform]) {
          platformBreakdown[platform].impressions += post.impressions;
          platformBreakdown[platform].clicks += post.clicks;
          platformBreakdown[platform].leadsCaptured += post.leadsCaptured;
        }
      });

      // Calculate platform rates
      Object.keys(platformBreakdown).forEach(platform => {
        const p = platform as SocialPlatform;
        const { impressions, clicks, leadsCaptured } = platformBreakdown[p];
        
        platformBreakdown[p].ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        platformBreakdown[p].conversionRate = clicks > 0 ? (leadsCaptured / clicks) * 100 : 0;
      });

      return {
        campaign,
        totalPosts: posts.length,
        totalImpressions,
        totalClicks,
        totalLeads,
        ctr,
        conversionRate,
        platformBreakdown
      };
    } catch (error) {
      console.error("Error getting campaign performance:", error);
      return null;
    }
  },

  // Lead Export methods
  async getAllLeadExports(page: number = 1, perPage: number = 10): Promise<PaginatedResponse<LeadExport>> {
    try {
      // Count total items
      const [{ value: totalItems }] = await db
        .select({ value: count() })
        .from(leadExports);

      // Get paginated data
      const data = await db
        .select()
        .from(leadExports)
        .orderBy(desc(leadExports.createdAt))
        .limit(perPage)
        .offset((page - 1) * perPage);

      return {
        data,
        meta: {
          currentPage: page,
          totalPages: Math.ceil(totalItems / perPage),
          totalItems,
          itemsPerPage: perPage,
        },
      };
    } catch (error) {
      console.error("Error getting lead exports:", error);
      return {
        data: [],
        meta: {
          currentPage: 1,
          totalPages: 0,
          totalItems: 0,
          itemsPerPage: 10,
        },
      };
    }
  },

  async getLeadExportById(id: number): Promise<LeadExport | null> {
    try {
      const [leadExport] = await db
        .select()
        .from(leadExports)
        .where(eq(leadExports.id, id));
      
      return leadExport || null;
    } catch (error) {
      console.error("Error getting lead export:", error);
      return null;
    }
  },

  async createLeadExport(data: InsertLeadExport): Promise<LeadExport> {
    try {
      const [newLeadExport] = await db
        .insert(leadExports)
        .values(data)
        .returning();
      
      return newLeadExport;
    } catch (error) {
      console.error("Error creating lead export:", error);
      throw new Error("Failed to create lead export record");
    }
  },

  async updateLeadExportDownloadCount(id: number): Promise<LeadExport | null> {
    try {
      const [updatedLeadExport] = await db
        .update(leadExports)
        .set({
          downloadCount: sql`${leadExports.downloadCount} + 1`
        })
        .where(eq(leadExports.id, id))
        .returning();
      
      return updatedLeadExport || null;
    } catch (error) {
      console.error("Error updating lead export download count:", error);
      return null;
    }
  },

  async deleteLeadExport(id: number): Promise<boolean> {
    try {
      const [deletedLeadExport] = await db
        .delete(leadExports)
        .where(eq(leadExports.id, id))
        .returning();
      
      return !!deletedLeadExport;
    } catch (error) {
      console.error("Error deleting lead export:", error);
      return false;
    }
  }
};