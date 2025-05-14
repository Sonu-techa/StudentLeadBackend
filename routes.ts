import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import path from "path";
import { insertLeadSchema, insertFormSchema, insertCampaignSchema } from "@shared/schema";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { scoreLead, batchScoreLeads } from "./lead-scoring";
import { 
  checkAndSchedulePosts, 
  runSocialPost, 
  runAllSocialPosts,
  generatePostContent 
} from "./ad-scheduler";
import cron from "node-cron";

// Function to validate and handle errors
function validateRequest(schema: z.ZodType<any, any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: error.errors });
      }
      next(error);
    }
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up authentication
  setupAuth(app);

  // Set up cron job to check and schedule posts every hour during business hours (9 AM to 6 PM IST)
  // Run every hour on weekdays
  cron.schedule("0 * 9-18 * * 1-5", async () => {
    console.log("Running scheduled task: checking and scheduling posts");
    await checkAndSchedulePosts();
  });

  // API Routes
  // Lead Form Submission
  app.post("/api/leads", validateRequest(insertLeadSchema), async (req, res) => {
    try {
      const lead = await storage.createLead(req.body);
      
      // Score the lead
      const { score, label } = scoreLead(lead);
      
      // Update the lead with the score
      await storage.updateLead(lead.id, { score });
      
      res.status(201).json({ ...lead, score, scoreLabel: label });
    } catch (error) {
      console.error("Error creating lead:", error);
      res.status(500).json({ message: "Error creating lead" });
    }
  });

  // Get lead by ID
  app.get("/api/leads/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid lead ID" });
      }
      
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      // Score the lead
      const { score, label, breakdown } = scoreLead(lead);
      
      res.json({ ...lead, score, scoreLabel: label, scoreBreakdown: breakdown });
    } catch (error) {
      console.error("Error fetching lead:", error);
      res.status(500).json({ message: "Error fetching lead" });
    }
  });

  // Admin API Routes (protected)
  // Get all leads with filters and pagination
  app.get("/api/admin/leads", async (req, res) => {
    try {
      const { 
        search, 
        source, 
        status, 
        fromDate, 
        toDate, 
        page, 
        perPage,
        sortBy,
        sortOrder 
      } = req.query;
      
      const filters = {
        search: search as string,
        source: source as string,
        status: status as string,
        dateRange: {
          from: fromDate as string,
          to: toDate as string,
        },
        page: page ? parseInt(page as string) : undefined,
        perPage: perPage ? parseInt(perPage as string) : undefined,
        sortBy: sortBy as string,
        sortOrder: sortOrder as "asc" | "desc",
      };
      
      const results = await storage.getAllLeads(filters);
      
      // Score all leads
      const scoredLeads = results.data.map(lead => {
        const { score, label } = scoreLead(lead);
        return { ...lead, score, scoreLabel: label };
      });
      
      res.json({
        data: scoredLeads,
        meta: results.meta,
      });
    } catch (error) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ message: "Error fetching leads" });
    }
  });

  // Update lead
  app.patch("/api/admin/leads/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid lead ID" });
      }
      
      const lead = await storage.updateLead(id, req.body);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      // Score the lead
      const { score, label } = scoreLead(lead);
      
      res.json({ ...lead, score, scoreLabel: label });
    } catch (error) {
      console.error("Error updating lead:", error);
      res.status(500).json({ message: "Error updating lead" });
    }
  });

  // Delete lead
  app.delete("/api/admin/leads/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid lead ID" });
      }
      
      const success = await storage.deleteLead(id);
      if (!success) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting lead:", error);
      res.status(500).json({ message: "Error deleting lead" });
    }
  });

  // Get dashboard stats
  app.get("/api/admin/dashboard/stats", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Error fetching dashboard stats" });
    }
  });

  // Get lead sources stats
  app.get("/api/admin/dashboard/lead-sources", async (req, res) => {
    try {
      const stats = await storage.getLeadSourcesStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching lead sources stats:", error);
      res.status(500).json({ message: "Error fetching lead sources stats" });
    }
  });

  // Get recent leads for dashboard
  app.get("/api/admin/dashboard/recent-leads", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 5;
      const leads = await storage.getRecentLeads(limit);
      
      // Score all leads
      const scoredLeads = leads.map(lead => {
        const { score, label } = scoreLead(lead);
        return { ...lead, score, scoreLabel: label };
      });
      
      res.json(scoredLeads);
    } catch (error) {
      console.error("Error fetching recent leads:", error);
      res.status(500).json({ message: "Error fetching recent leads" });
    }
  });

  // Export leads to CSV
  app.get("/api/admin/leads/export", async (req, res) => {
    try {
      const { 
        search, 
        source, 
        status, 
        fromDate, 
        toDate 
      } = req.query;
      
      const filters = {
        search: search as string,
        source: source as string,
        status: status as string,
        dateRange: {
          from: fromDate as string,
          to: toDate as string,
        },
        perPage: 1000, // Get a large batch for export
      };
      
      const results = await storage.getAllLeads(filters);
      
      // Score all leads
      const scoredLeads = results.data.map(lead => {
        const { score, label } = scoreLead(lead);
        return { ...lead, score, scoreLabel: label };
      });
      
      // Convert to CSV format
      const headers = "ID,Name,Email,Phone,Age,Education,College,State,City,Source,Status,Score,Quality,Created At\n";
      const rows = scoredLeads.map(lead => {
        return `${lead.id},"${lead.name}","${lead.email}","${lead.phone}","${lead.age}","${lead.education}","${lead.college || ''}","${lead.state}","${lead.city}","${lead.source}","${lead.status}","${lead.score}","${lead.scoreLabel}","${lead.createdAt}"\n`;
      }).join('');
      
      const csv = headers + rows;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=leads.csv');
      res.status(200).send(csv);
    } catch (error) {
      console.error("Error exporting leads:", error);
      res.status(500).json({ message: "Error exporting leads" });
    }
  });

  // Forms API
  // Get all forms
  app.get("/api/admin/forms", async (req, res) => {
    try {
      const forms = await storage.getAllForms();
      res.json(forms);
    } catch (error) {
      console.error("Error fetching forms:", error);
      res.status(500).json({ message: "Error fetching forms" });
    }
  });

  // Get form by ID
  app.get("/api/admin/forms/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid form ID" });
      }
      
      const form = await storage.getFormById(id);
      if (!form) {
        return res.status(404).json({ message: "Form not found" });
      }
      
      res.json(form);
    } catch (error) {
      console.error("Error fetching form:", error);
      res.status(500).json({ message: "Error fetching form" });
    }
  });

  // Create form
  app.post("/api/admin/forms", validateRequest(insertFormSchema), async (req, res) => {
    try {
      const form = await storage.createForm(req.body);
      res.status(201).json(form);
    } catch (error) {
      console.error("Error creating form:", error);
      res.status(500).json({ message: "Error creating form" });
    }
  });

  // Update form
  app.patch("/api/admin/forms/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid form ID" });
      }
      
      const form = await storage.updateForm(id, req.body);
      if (!form) {
        return res.status(404).json({ message: "Form not found" });
      }
      
      res.json(form);
    } catch (error) {
      console.error("Error updating form:", error);
      res.status(500).json({ message: "Error updating form" });
    }
  });

  // Delete form
  app.delete("/api/admin/forms/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid form ID" });
      }
      
      const success = await storage.deleteForm(id);
      if (!success) {
        return res.status(404).json({ message: "Form not found" });
      }
      
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting form:", error);
      res.status(500).json({ message: "Error deleting form" });
    }
  });

  // Campaigns API
  // Get all campaigns
  app.get("/api/admin/campaigns", async (req, res) => {
    try {
      const { 
        search, 
        status, 
        fromDate, 
        toDate, 
        page, 
        perPage,
        sortBy,
        sortOrder 
      } = req.query;
      
      const filters = {
        search: search as string,
        status: status as string,
        dateRange: {
          from: fromDate as string,
          to: toDate as string,
        },
        page: page ? parseInt(page as string) : undefined,
        perPage: perPage ? parseInt(perPage as string) : undefined,
        sortBy: sortBy as string,
        sortOrder: sortOrder as "asc" | "desc",
      };
      
      const results = await storage.getAllCampaigns(filters);
      res.json(results);
    } catch (error) {
      console.error("Error fetching campaigns:", error);
      res.status(500).json({ message: "Error fetching campaigns" });
    }
  });

  // Get campaign by ID
  app.get("/api/admin/campaigns/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid campaign ID" });
      }
      
      const campaign = await storage.getCampaignById(id);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      
      res.json(campaign);
    } catch (error) {
      console.error("Error fetching campaign:", error);
      res.status(500).json({ message: "Error fetching campaign" });
    }
  });

  // Get active campaign
  app.get("/api/admin/campaigns/active", async (req, res) => {
    try {
      const campaign = await storage.getActiveCampaign();
      if (!campaign) {
        return res.status(404).json({ message: "No active campaign found" });
      }
      
      res.json(campaign);
    } catch (error) {
      console.error("Error fetching active campaign:", error);
      res.status(500).json({ message: "Error fetching active campaign" });
    }
  });

  // Create campaign
  app.post("/api/admin/campaigns", validateRequest(insertCampaignSchema), async (req, res) => {
    try {
      const campaign = await storage.createCampaign(req.body);
      res.status(201).json(campaign);
    } catch (error) {
      console.error("Error creating campaign:", error);
      res.status(500).json({ message: "Error creating campaign" });
    }
  });

  // Update campaign
  app.patch("/api/admin/campaigns/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid campaign ID" });
      }
      
      const campaign = await storage.updateCampaign(id, req.body);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      
      res.json(campaign);
    } catch (error) {
      console.error("Error updating campaign:", error);
      res.status(500).json({ message: "Error updating campaign" });
    }
  });

  // Delete campaign
  app.delete("/api/admin/campaigns/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid campaign ID" });
      }
      
      const success = await storage.deleteCampaign(id);
      if (!success) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting campaign:", error);
      res.status(500).json({ message: "Error deleting campaign" });
    }
  });

  // Ad Posts API
  // Get all ad posts for a campaign
  app.get("/api/admin/campaigns/:id/ad-posts", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid campaign ID" });
      }
      
      const adPosts = await storage.getAllAdPosts(id);
      res.json(adPosts);
    } catch (error) {
      console.error("Error fetching ad posts:", error);
      res.status(500).json({ message: "Error fetching ad posts" });
    }
  });

  // Get ad post by ID
  app.get("/api/admin/ad-posts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ad post ID" });
      }
      
      const adPost = await storage.getAdPostById(id);
      if (!adPost) {
        return res.status(404).json({ message: "Ad post not found" });
      }
      
      res.json(adPost);
    } catch (error) {
      console.error("Error fetching ad post:", error);
      res.status(500).json({ message: "Error fetching ad post" });
    }
  });

  // Get all ad posts
  app.get("/api/admin/ad-posts", async (req, res) => {
    try {
      const adPosts = await storage.getAllAdPosts();
      res.json(adPosts);
    } catch (error) {
      console.error("Error fetching ad posts:", error);
      res.status(500).json({ message: "Error fetching ad posts" });
    }
  });

  // Get campaign performance
  app.get("/api/admin/campaigns/:id/performance", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid campaign ID" });
      }
      
      const performance = await storage.getCampaignPerformance(id);
      if (!performance) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      
      res.json(performance);
    } catch (error) {
      console.error("Error fetching campaign performance:", error);
      res.status(500).json({ message: "Error fetching campaign performance" });
    }
  });

  // Run a simulated social media post
  app.post("/api/admin/simulate-ad-post", async (req, res) => {
    try {
      const { platform } = req.body;
      if (!platform) {
        return res.status(400).json({ message: "Platform is required" });
      }
      
      const validPlatforms = ["facebook", "instagram", "twitter", "whatsapp", "telegram"];
      if (!validPlatforms.includes(platform)) {
        return res.status(400).json({ message: "Invalid platform" });
      }
      
      const adPost = await runSocialPost(platform);
      if (!adPost) {
        return res.status(400).json({ message: "Failed to create ad post. No active campaign." });
      }
      
      res.status(201).json(adPost);
    } catch (error) {
      console.error("Error simulating ad post:", error);
      res.status(500).json({ message: "Error simulating ad post" });
    }
  });

  // Run simulated posts on all platforms
  app.post("/api/admin/run-all-ads", async (req, res) => {
    try {
      const adPosts = await runAllSocialPosts();
      if (adPosts.length === 0) {
        return res.status(400).json({ message: "Failed to create ad posts. No active campaign." });
      }
      
      res.status(201).json(adPosts);
    } catch (error) {
      console.error("Error running all ads:", error);
      res.status(500).json({ message: "Error running all ads" });
    }
  });

  // Preview ad post content
  app.post("/api/admin/preview-ad-content", async (req, res) => {
    try {
      const { message, platform } = req.body;
      if (!message || !platform) {
        return res.status(400).json({ message: "Message and platform are required" });
      }
      
      const validPlatforms = ["facebook", "instagram", "twitter", "whatsapp", "telegram"];
      if (!validPlatforms.includes(platform)) {
        return res.status(400).json({ message: "Invalid platform" });
      }
      
      const content = generatePostContent(message, platform);
      res.json({ content });
    } catch (error) {
      console.error("Error generating ad content:", error);
      res.status(500).json({ message: "Error generating ad content" });
    }
  });

  // Get form embed code
  app.get("/api/admin/forms/:id/embed", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid form ID" });
      }
      
      const form = await storage.getFormById(id);
      if (!form) {
        return res.status(404).json({ message: "Form not found" });
      }
      
      // Generate embed code
      const host = req.get('host');
      const protocol = req.protocol;
      const formUrl = `${protocol}://${host}/form/${id}`;
      
      const embedCode = `<iframe src="${formUrl}" width="100%" height="600px" frameborder="0"></iframe>`;
      const directLink = formUrl;
      
      res.json({ embedCode, directLink });
    } catch (error) {
      console.error("Error generating embed code:", error);
      res.status(500).json({ message: "Error generating embed code" });
    }
  });

  // Get public form data
  app.get("/api/forms/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid form ID" });
      }
      
      const form = await storage.getFormById(id);
      if (!form) {
        return res.status(404).json({ message: "Form not found" });
      }
      
      // Return only public data
      res.json({
        id: form.id,
        name: form.name,
        description: form.description,
      });
    } catch (error) {
      console.error("Error fetching form:", error);
      res.status(500).json({ message: "Error fetching form" });
    }
  });

  // Create HTTP server
  const httpServer = createServer(app);
  
  // Set up vite development server or static file serving
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, httpServer);
  } else {
    const { serveStatic } = await import("./vite");
    serveStatic(app);
  }
  
  // Catch-all route for SPA - must be after all API routes
  app.get('*', (req, res) => {
    // Exclude API paths
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ message: 'API endpoint not found' });
    }
    
    // Serve the SPA's index.html for all other routes
    if (process.env.NODE_ENV === "development") {
      res.sendFile(path.resolve(__dirname, '..', 'client', 'index.html'));
    } else {
      res.sendFile(path.resolve(__dirname, '..', 'dist', 'public', 'index.html'));
    }
  });

  return httpServer;
}
