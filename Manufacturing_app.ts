import { ChangeDetectionStrategy, Component, computed, signal, inject, effect } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, Auth } from 'firebase/auth';
import { getFirestore, Firestore, collection, onSnapshot, query, addDoc, updateDoc, deleteDoc, doc, Timestamp, orderBy, where } from 'firebase/firestore';

// --- Type Definitions ---

interface InventoryItem {
  id?: string;
  name: string;
  type: 'raw' | 'finished';
  quantity: number;
  unitCost: number; // Cost per unit
  totalValue: number; // Computed: quantity * unitCost
}

interface ExpenseRecord {
  id?: string;
  description: string;
  category: string; // e.g., 'Rent', 'Wages', 'Utilities', 'Material Purchase'
  amount: number;
  date: Timestamp;
}

// --- Global Constants (for Firebase Initialization) ---
// These global variables are provided by the canvas environment.
declare const __app_id: string;
declare const __firebase_config: string;
declare const __initial_auth_token: string;

@Component({
  selector: 'app-root',
  template: `
    <!-- Main Application Container -->
    <div class="min-h-screen bg-gray-50 flex flex-col antialiased">
      <!-- Header / Navigation -->
      <header class="bg-indigo-700 shadow-md sticky top-0 z-10">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-center justify-between h-16">
            <h1 class="text-xl font-bold text-white tracking-wider">
              <span class="hidden sm:inline">MFR</span>-Manager
            </h1>
            <nav class="flex space-x-2 sm:space-x-4">
              <button (click)="setCurrentView('dashboard')" [class]="getNavClass('dashboard')">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 mr-1"><path d="M12 20h9"/><path d="M19 13V5"/><rect width="6" height="4" x="2" y="10" rx="1"/><rect width="6" height="7" x="2" y="3" rx="1"/><rect width="6" height="9" x="2" y="15" rx="1"/></svg>
                Dashboard
              </button>
              <button (click)="setCurrentView('inventory')" [class]="getNavClass('inventory')">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 mr-1"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"/></svg>
                Stock
              </button>
              <button (click)="setCurrentView('expenses')" [class]="getNavClass('expenses')">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 mr-1"><path d="M21 15V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14"/><path d="M7 15h0.01"/><path d="M17 15h0.01"/><path d="M12 15h0.01"/><path d="M12 7v5"/></svg>
                Expenses
              </button>
            </nav>
          </div>
        </div>
      </header>

      <!-- Main Content Area -->
      <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-grow">
        <!-- Auth Status & User ID -->
        <div class="mb-4 p-3 bg-white rounded-lg shadow-sm text-xs text-gray-500 overflow-x-auto">
          <p>
            Status: <span [class]="isAuthReady() ? 'text-green-600 font-medium' : 'text-yellow-600 font-medium'">{{ isAuthReady() ? 'Connected' : 'Connecting...' }}</span> |
            User ID: <span class="font-mono bg-gray-100 p-1 rounded">{{ userId() || 'N/A' }}</span>
          </p>
        </div>

        <!-- Dynamic View Rendering -->
        <div *ngIf="isAuthReady()">
          <div [ngSwitch]="currentView()">
            <div *ngSwitchCase="'dashboard'">
              {{ renderDashboard() }}
            </div>
            <div *ngSwitchCase="'inventory'">
              {{ renderInventory() }}
            </div>
            <div *ngSwitchCase="'expenses'">
              {{ renderExpenses() }}
            </div>
          </div>
        </div>
        <div *ngIf="!isAuthReady()" class="flex justify-center items-center h-64">
          <div class="text-center p-6 bg-white rounded-xl shadow-lg">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto mb-4"></div>
            <p class="text-gray-700">Loading application data and authenticating...</p>
          </div>
        </div>
      </main>
      
      <!-- Footer (Optional) -->
      <footer class="mt-auto py-4 text-center text-xs text-gray-500 border-t bg-white">
        Manufacturing Manager | Powered by Angular & Firestore
      </footer>

      <!-- Modals for Add/Edit -->
      {{ renderInventoryModal() }}
      {{ renderExpenseModal() }}
      {{ renderConfirmModal() }}
    </div>
  `,
  styles: [`
    /* Custom styles for better aesthetics */
    .btn-primary {
      @apply bg-indigo-600 text-white p-3 rounded-xl shadow-md hover:bg-indigo-700 transition duration-150 flex items-center justify-center;
    }
    .btn-secondary {
      @apply bg-gray-200 text-gray-700 p-3 rounded-xl shadow-sm hover:bg-gray-300 transition duration-150;
    }
    .nav-base {
      @apply py-2 px-3 sm:px-4 rounded-lg font-medium text-sm transition-colors duration-150 flex items-center;
    }
    .nav-active {
      @apply bg-indigo-800 text-white;
    }
    .nav-inactive {
      @apply text-indigo-200 hover:bg-indigo-600;
    }
    /* Simple Modal Backdrop */
    .modal-backdrop {
      @apply fixed inset-0 bg-gray-900 bg-opacity-75 z-50 flex items-center justify-center p-4;
    }
    .modal-content {
      @apply bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4 transform transition-all;
    }
  `],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  // --- Signals for State Management ---
  db = signal<Firestore | null>(null);
  auth = signal<Auth | null>(null);
  userId = signal<string | null>(null);
  isAuthReady = signal(false);

  currentView = signal<'dashboard' | 'inventory' | 'expenses'>('dashboard');
  
  inventoryItems = signal<InventoryItem[]>([]);
  expenseRecords = signal<ExpenseRecord[]>([]);

  // Modal State
  isInventoryModalOpen = signal(false);
  editingInventoryItem = signal<InventoryItem | null>(null);
  
  isExpenseModalOpen = signal(false);
  editingExpenseRecord = signal<ExpenseRecord | null>(null);

  // Form State (for Inventory)
  invName = signal('');
  invType = signal<'raw' | 'finished'>('raw');
  invQuantity = signal(0);
  invUnitCost = signal(0);

  // Form State (for Expenses)
  expDesc = signal('');
  expCategory = signal('');
  expAmount = signal(0);
  expDate = signal(this.formatDate(new Date()));

  // Confirmation Modal
  isConfirmModalOpen = signal(false);
  confirmMessage = signal('');
  confirmAction: (() => void) | null = null;
  confirmCancel: (() => void) | null = null;

  // --- Computed Properties for Dashboard ---

  // Total value of all stock
  totalInventoryValue = computed(() => {
    return this.inventoryItems().reduce((sum, item) => sum + item.totalValue, 0);
  });

  // Total expenses in the last 30 days
  totalMonthlyExpenses = computed(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return this.expenseRecords()
      .filter(exp => exp.date.toDate() >= thirtyDaysAgo)
      .reduce((sum, exp) => sum + exp.amount, 0);
  });

  // Stock count by type
  inventorySummary = computed(() => {
    const raw = this.inventoryItems().filter(i => i.type === 'raw').length;
    const finished = this.inventoryItems().filter(i => i.type === 'finished').length;
    return { raw, finished };
  });

  // --- Constructor and Initialization ---

  constructor() {
    // 1. Initialize Firebase and Authentication
    this.initFirebase();

    // 2. Set up effect to listen for Auth readiness and start data listeners
    effect(() => {
      if (this.isAuthReady() && this.db() && this.userId()) {
        this.attachDataListeners();
      }
    });
  }
  
  // --- Utility Methods ---

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2
    }).format(value);
  }

  formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  getNavClass(view: 'dashboard' | 'inventory' | 'expenses'): string {
    const base = 'nav-base';
    const active = this.currentView() === view ? 'nav-active' : 'nav-inactive';
    return `${base} ${active}`;
  }

  setCurrentView(view: 'dashboard' | 'inventory' | 'expenses') {
    this.currentView.set(view);
  }

  // --- Firebase and Authentication ---

  async initFirebase() {
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
      
      if (!firebaseConfig || !Object.keys(firebaseConfig).length) {
          console.error("FIREBASE ERROR: Configuration is missing or empty.");
          return;
      }
      
      const app = initializeApp(firebaseConfig);
      const authInstance = getAuth(app);
      const dbInstance = getFirestore(app);
      
      this.db.set(dbInstance);
      this.auth.set(authInstance);

      // Log level for debugging
      // setLogLevel('debug'); // Note: Cannot import setLogLevel in single file

      let initialAuthAttempted = false;

      // Ensure the auth token is used if available, otherwise sign in anonymously
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(authInstance, __initial_auth_token)
          .catch(e => {
            console.error("Custom token sign-in failed, trying anonymous.", e);
            return signInAnonymously(authInstance);
          });
      } else {
        await signInAnonymously(authInstance);
      }
      initialAuthAttempted = true;

      onAuthStateChanged(authInstance, (user) => {
        if (user) {
          this.userId.set(user.uid);
          this.isAuthReady.set(true);
          console.log("Firebase Auth Ready. User ID:", user.uid);
        } else {
          // If the initial attempt was made and failed/logged out, log in anonymously again
          if (initialAuthAttempted) {
             signInAnonymously(authInstance);
          }
          this.userId.set(null);
          this.isAuthReady.set(true);
        }
      });

    } catch (e) {
      console.error("FIREBASE FATAL ERROR during initialization:", e);
      this.isAuthReady.set(true); // Still mark as ready to show error message
    }
  }

  // --- Firestore Data Listeners ---

  attachDataListeners() {
    const db = this.db();
    const userId = this.userId();
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    
    if (!db || !userId) return;

    // 1. Inventory Listener
    const invPath = `/artifacts/${appId}/users/${userId}/inventory`;
    const invQ = query(collection(db, invPath));
    onSnapshot(invQ, (snapshot) => {
      const items: InventoryItem[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        const item: InventoryItem = {
          id: doc.id,
          name: data['name'],
          type: data['type'],
          quantity: data['quantity'],
          unitCost: data['unitCost'],
          totalValue: data['quantity'] * data['unitCost'] // Recalculate locally
        };
        items.push(item);
      });
      this.inventoryItems.set(items);
      console.log("Inventory Updated:", items.length, "items.");
    }, (error) => {
      console.error("Firestore Inventory Snapshot Error:", error);
    });

    // 2. Expenses Listener
    const expPath = `/artifacts/${appId}/users/${userId}/expenses`;
    // Order by date descending for easier viewing
    const expQ = query(collection(db, expPath), orderBy('date', 'desc')); 
    onSnapshot(expQ, (snapshot) => {
      const records: ExpenseRecord[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        const record: ExpenseRecord = {
          id: doc.id,
          description: data['description'],
          category: data['category'],
          amount: data['amount'],
          date: data['date'] // Firestore Timestamp
        };
        records.push(record);
      });
      this.expenseRecords.set(records);
      console.log("Expenses Updated:", records.length, "records.");
    }, (error) => {
      console.error("Firestore Expenses Snapshot Error:", error);
    });
  }

  // --- Inventory CRUD Operations ---

  openInventoryModal(item: InventoryItem | null = null) {
    if (item) {
      this.editingInventoryItem.set(item);
      this.invName.set(item.name);
      this.invType.set(item.type);
      this.invQuantity.set(item.quantity);
      this.invUnitCost.set(item.unitCost);
    } else {
      this.editingInventoryItem.set(null);
      this.invName.set('');
      this.invType.set('raw');
      this.invQuantity.set(0);
      this.invUnitCost.set(0);
    }
    this.isInventoryModalOpen.set(true);
  }

  closeInventoryModal() {
    this.isInventoryModalOpen.set(false);
  }

  async saveInventoryItem() {
    const db = this.db();
    const userId = this.userId();
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    if (!db || !userId) { console.error("Database not ready."); return; }

    const itemData: Omit<InventoryItem, 'id' | 'totalValue'> = {
      name: this.invName(),
      type: this.invType(),
      quantity: Math.max(0, this.invQuantity()), // Ensure non-negative
      unitCost: Math.max(0, this.invUnitCost()), // Ensure non-negative
    };

    const path = `/artifacts/${appId}/users/${userId}/inventory`;

    try {
      const editingItem = this.editingInventoryItem();
      if (editingItem && editingItem.id) {
        // Update existing document
        const itemRef = doc(db, path, editingItem.id);
        await updateDoc(itemRef, itemData as any);
        console.log("Inventory item updated:", editingItem.id);
      } else {
        // Add new document
        await addDoc(collection(db, path), itemData);
        console.log("Inventory item added.");
      }
      this.closeInventoryModal();
    } catch (e) {
      console.error("Error saving inventory item:", e);
      // In a real app, you'd show a user-friendly error message here
    }
  }
  
  deleteInventoryItem(item: InventoryItem) {
    this.confirmAction = async () => {
      const db = this.db();
      const userId = this.userId();
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

      if (!db || !userId || !item.id) { console.error("Database or Item ID missing for delete."); return; }

      const path = `/artifacts/${appId}/users/${userId}/inventory`;
      try {
        await deleteDoc(doc(db, path, item.id));
        console.log("Inventory item deleted:", item.id);
        this.closeConfirmModal();
      } catch (e) {
        console.error("Error deleting inventory item:", e);
      }
    };
    this.confirmMessage.set(`Are you sure you want to delete the inventory item: "${item.name}"? This action cannot be undone.`);
    this.isConfirmModalOpen.set(true);
  }

  // --- Expense CRUD Operations ---

  openExpenseModal(record: ExpenseRecord | null = null) {
    if (record) {
      this.editingExpenseRecord.set(record);
      this.expDesc.set(record.description);
      this.expCategory.set(record.category);
      this.expAmount.set(record.amount);
      this.expDate.set(this.formatDate(record.date.toDate()));
    } else {
      this.editingExpenseRecord.set(null);
      this.expDesc.set('');
      this.expCategory.set('');
      this.expAmount.set(0);
      this.expDate.set(this.formatDate(new Date()));
    }
    this.isExpenseModalOpen.set(true);
  }

  closeExpenseModal() {
    this.isExpenseModalOpen.set(false);
  }

  async saveExpenseRecord() {
    const db = this.db();
    const userId = this.userId();
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    if (!db || !userId) { console.error("Database not ready."); return; }

    const expenseData: Omit<ExpenseRecord, 'id'> = {
      description: this.expDesc(),
      category: this.expCategory(),
      amount: Math.max(0.01, this.expAmount()), // Must be positive
      date: Timestamp.fromDate(new Date(this.expDate())),
    };

    const path = `/artifacts/${appId}/users/${userId}/expenses`;

    try {
      const editingRecord = this.editingExpenseRecord();
      if (editingRecord && editingRecord.id) {
        // Update existing document
        const recordRef = doc(db, path, editingRecord.id);
        await updateDoc(recordRef, expenseData as any);
        console.log("Expense record updated:", editingRecord.id);
      } else {
        // Add new document
        await addDoc(collection(db, path), expenseData);
        console.log("Expense record added.");
      }
      this.closeExpenseModal();
    } catch (e) {
      console.error("Error saving expense record:", e);
    }
  }

  deleteExpenseRecord(record: ExpenseRecord) {
    this.confirmAction = async () => {
      const db = this.db();
      const userId = this.userId();
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

      if (!db || !userId || !record.id) { console.error("Database or Record ID missing for delete."); return; }

      const path = `/artifacts/${appId}/users/${userId}/expenses`;
      try {
        await deleteDoc(doc(db, path, record.id));
        console.log("Expense record deleted:", record.id);
        this.closeConfirmModal();
      } catch (e) {
        console.error("Error deleting expense record:", e);
      }
    };
    this.confirmMessage.set(`Are you sure you want to delete the expense: "${record.description}" (${this.formatCurrency(record.amount)})?`);
    this.isConfirmModalOpen.set(true);
  }
  
  // --- Confirmation Modal Handlers ---
  closeConfirmModal() {
    this.isConfirmModalOpen.set(false);
    this.confirmAction = null;
    this.confirmCancel = null;
  }

  executeConfirmAction() {
    if (this.confirmAction) {
      this.confirmAction();
    } else {
      this.closeConfirmModal();
    }
  }

  // --- View Rendering (via methods to return template strings/fragments) ---

  // Renders the Dashboard View
  renderDashboard(): string {
    const totalInv = this.formatCurrency(this.totalInventoryValue());
    const monthlyExp = this.formatCurrency(this.totalMonthlyExpenses());
    const { raw, finished } = this.inventorySummary();

    return `
      <h2 class="text-3xl font-extrabold text-gray-900 mb-6 border-b pb-2">
        Manufacturing Dashboard
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- Metric Card: Inventory Value -->
        <div class="bg-white rounded-xl shadow-lg p-6 border-b-4 border-indigo-500">
          <p class="text-sm font-medium text-gray-500">Total Stock Value</p>
          <p class="text-3xl font-bold text-gray-900 mt-1">${totalInv}</p>
          <p class="text-xs text-gray-400 mt-2">Valuation of all Raw & Finished Goods</p>
        </div>

        <!-- Metric Card: Monthly Expenses -->
        <div class="bg-white rounded-xl shadow-lg p-6 border-b-4 border-red-500">
          <p class="text-sm font-medium text-gray-500">Last 30 Days Expenses</p>
          <p class="text-3xl font-bold text-red-600 mt-1">${monthlyExp}</p>
          <p class="text-xs text-gray-400 mt-2">Operational costs and purchases</p>
        </div>

        <!-- Metric Card: Inventory Split -->
        <div class="bg-white rounded-xl shadow-lg p-6 border-b-4 border-green-500">
          <p class="text-sm font-medium text-gray-500">Inventory Items Count</p>
          <div class="mt-2 text-xl font-bold text-gray-900">
            <span class="text-indigo-600">${raw}</span> Raw Materials
            <span class="ml-4 text-green-600">${finished}</span> Finished Goods
          </div>
          <p class="text-xs text-gray-400 mt-2">Total distinct items tracked in stock</p>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="mt-8">
        <h3 class="text-xl font-semibold text-gray-800 mb-4">Quick Actions</h3>
        <div class="flex flex-wrap gap-3">
          <button (click)="openInventoryModal()" class="btn-primary py-2 px-4 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            Add New Stock Item
          </button>
          <button (click)="openExpenseModal()" class="btn-primary py-2 px-4 text-sm bg-red-600 hover:bg-red-700">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            Record New Expense
          </button>
        </div>
      </div>
    `;
  }

  // Renders the Inventory View
  renderInventory(): string {
    const items = this.inventoryItems();
    const invRows = items.length === 0 
      ? `
        <tr class="bg-white"><td colspan="6" class="p-4 text-center text-gray-500">No inventory items found. Add your first item!</td></tr>
      `
      : items.map(item => `
        <tr class="border-b last:border-b-0 hover:bg-indigo-50 transition-colors duration-100">
          <td class="px-3 sm:px-6 py-3 font-medium text-gray-900">${item.name}</td>
          <td class="px-3 sm:px-6 py-3">
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${item.type === 'raw' ? 'bg-indigo-100 text-indigo-800' : 'bg-green-100 text-green-800'}">
              ${item.type === 'raw' ? 'Raw Material' : 'Finished Good'}
            </span>
          </td>
          <td class="px-3 sm:px-6 py-3">${item.quantity}</td>
          <td class="px-3 sm:px-6 py-3">${this.formatCurrency(item.unitCost)}</td>
          <td class="px-3 sm:px-6 py-3 font-semibold">${this.formatCurrency(item.totalValue)}</td>
          <td class="px-3 sm:px-6 py-3 text-right whitespace-nowrap">
            <button (click)="openInventoryModal(inventoryItems().find(i => i.id === '${item.id}'))" class="text-indigo-600 hover:text-indigo-900 text-sm mr-3">Edit</button>
            <button (click)="deleteInventoryItem(inventoryItems().find(i => i.id === '${item.id}')!)" class="text-red-600 hover:text-red-900 text-sm">Delete</button>
          </td>
        </tr>
      `).join('');

    return `
      <h2 class="text-3xl font-extrabold text-gray-900 mb-6 border-b pb-2">
        Inventory Management
      </h2>
      <div class="mb-4 flex justify-between items-center">
        <h3 class="text-lg font-semibold text-gray-700">Stock List (${items.length} items)</h3>
        <button (click)="openInventoryModal()" class="btn-primary py-2 px-3 text-sm">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          Add Item
        </button>
      </div>

      <!-- Responsive Table Container -->
      <div class="bg-white shadow-xl rounded-xl overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th scope="col" class="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item Name</th>
              <th scope="col" class="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
              <th scope="col" class="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
              <th scope="col" class="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit Cost</th>
              <th scope="col" class="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Value</th>
              <th scope="col" class="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${invRows}
          </tbody>
        </table>
      </div>
    `;
  }
  
  // Renders the Expenses View
  renderExpenses(): string {
    const records = this.expenseRecords();
    const expRows = records.length === 0
      ? `
        <tr class="bg-white"><td colspan="5" class="p-4 text-center text-gray-500">No expense records found.</td></tr>
      `
      : records.map(record => `
        <tr class="border-b last:border-b-0 hover:bg-red-50 transition-colors duration-100">
          <td class="px-3 sm:px-6 py-3 font-medium text-gray-900">${record.description}</td>
          <td class="px-3 sm:px-6 py-3 text-sm text-gray-500">${record.category}</td>
          <td class="px-3 sm:px-6 py-3 text-red-600 font-semibold">${this.formatCurrency(record.amount)}</td>
          <td class="px-3 sm:px-6 py-3 text-sm">${this.formatDate(record.date.toDate())}</td>
          <td class="px-3 sm:px-6 py-3 text-right whitespace-nowrap">
            <button (click)="openExpenseModal(expenseRecords().find(r => r.id === '${record.id}'))" class="text-indigo-600 hover:text-indigo-900 text-sm mr-3">Edit</button>
            <button (click)="deleteExpenseRecord(expenseRecords().find(r => r.id === '${record.id}')!)" class="text-red-600 hover:text-red-900 text-sm">Delete</button>
          </td>
        </tr>
      `).join('');

    return `
      <h2 class="text-3xl font-extrabold text-gray-900 mb-6 border-b pb-2">
        Expense Tracking
      </h2>
      <div class="mb-4 flex justify-between items-center">
        <h3 class="text-lg font-semibold text-gray-700">Recent Expenses (${records.length} records)</h3>
        <button (click)="openExpenseModal()" class="btn-primary py-2 px-3 text-sm bg-red-600 hover:bg-red-700">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          Record Expense
        </button>
      </div>

      <!-- Responsive Table Container -->
      <div class="bg-white shadow-xl rounded-xl overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th scope="col" class="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
              <th scope="col" class="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
              <th scope="col" class="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
              <th scope="col" class="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th scope="col" class="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${expRows}
          </tbody>
        </table>
      </div>
    `;
  }
  
  // Renders the Inventory Add/Edit Modal
  renderInventoryModal(): string {
    if (!this.isInventoryModalOpen()) return '';
    
    const isEdit = !!this.editingInventoryItem();
    const totalVal = this.formatCurrency(this.invQuantity() * this.invUnitCost());

    return `
      <div class="modal-backdrop">
        <div class="modal-content">
          <h3 class="text-2xl font-bold text-gray-900">
            ${isEdit ? 'Edit Inventory Item' : 'Add New Inventory Item'}
          </h3>
          <form (submit)="saveInventoryItem()" class="space-y-4">
            <!-- Name -->
            <div>
              <label for="invName" class="block text-sm font-medium text-gray-700">Item Name</label>
              <input type="text" id="invName" required
                     [value]="invName()" (input)="invName.set($event.target.value)"
                     class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm p-3 border focus:ring-indigo-500 focus:border-indigo-500">
            </div>

            <!-- Type -->
            <div>
              <label for="invType" class="block text-sm font-medium text-gray-700">Item Type</label>
              <select id="invType" required
                      [value]="invType()" (change)="invType.set($event.target.value)"
                      class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm p-3 border focus:ring-indigo-500 focus:border-indigo-500">
                <option value="raw">Raw Material</option>
                <option value="finished">Finished Good</option>
              </select>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <!-- Quantity -->
              <div>
                <label for="invQuantity" class="block text-sm font-medium text-gray-700">Quantity</label>
                <input type="number" id="invQuantity" required min="0" step="1"
                       [value]="invQuantity()" (input)="invQuantity.set(+$event.target.value)"
                       class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm p-3 border focus:ring-indigo-500 focus:border-indigo-500">
              </div>

              <!-- Unit Cost -->
              <div>
                <label for="invUnitCost" class="block text-sm font-medium text-gray-700">Unit Cost (USD)</label>
                <input type="number" id="invUnitCost" required min="0" step="0.01"
                       [value]="invUnitCost()" (input)="invUnitCost.set(+$event.target.value)"
                       class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm p-3 border focus:ring-indigo-500 focus:border-indigo-500">
              </div>
            </div>

            <!-- Calculated Value -->
            <p class="text-md font-medium text-gray-700 pt-2">
              Calculated Total Value: <span class="text-indigo-600 font-bold">${totalVal}</span>
            </p>

            <div class="flex justify-end space-x-3 pt-4">
              <button type="button" (click)="closeInventoryModal()" class="btn-secondary">
                Cancel
              </button>
              <button type="submit" class="btn-primary">
                ${isEdit ? 'Save Changes' : 'Add Item'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }
  
  // Renders the Expense Add/Edit Modal
  renderExpenseModal(): string {
    if (!this.isExpenseModalOpen()) return '';
    
    const isEdit = !!this.editingExpenseRecord();

    // Simple list of common categories
    const categories = ['Wages', 'Rent', 'Utilities', 'Material Purchase', 'Maintenance', 'Shipping', 'Office Supplies', 'Other'];
    const categoryOptions = categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');

    return `
      <div class="modal-backdrop">
        <div class="modal-content">
          <h3 class="text-2xl font-bold text-gray-900">
            ${isEdit ? 'Edit Expense Record' : 'Record New Expense'}
          </h3>
          <form (submit)="saveExpenseRecord()" class="space-y-4">
            <!-- Description -->
            <div>
              <label for="expDesc" class="block text-sm font-medium text-gray-700">Description</label>
              <input type="text" id="expDesc" required
                     [value]="expDesc()" (input)="expDesc.set($event.target.value)"
                     class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm p-3 border focus:ring-red-500 focus:border-red-500">
            </div>

            <!-- Category -->
            <div>
              <label for="expCategory" class="block text-sm font-medium text-gray-700">Category</label>
              <select id="expCategory" required
                      [value]="expCategory()" (change)="expCategory.set($event.target.value)"
                      class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm p-3 border focus:ring-red-500 focus:border-red-500">
                <option value="" disabled>Select a category</option>
                ${categoryOptions}
                <option value="Custom">Custom</option>
              </select>
              ${this.expCategory() === 'Custom' ? `
                <input type="text" placeholder="Enter custom category name" required
                       (input)="expCategory.set($event.target.value)"
                       class="mt-2 block w-full rounded-lg border-gray-300 shadow-sm p-3 border focus:ring-red-500 focus:border-red-500">
              ` : ''}
            </div>

            <div class="grid grid-cols-2 gap-4">
              <!-- Amount -->
              <div>
                <label for="expAmount" class="block text-sm font-medium text-gray-700">Amount (USD)</label>
                <input type="number" id="expAmount" required min="0.01" step="0.01"
                       [value]="expAmount()" (input)="expAmount.set(+$event.target.value)"
                       class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm p-3 border focus:ring-red-500 focus:border-red-500">
              </div>

              <!-- Date -->
              <div>
                <label for="expDate" class="block text-sm font-medium text-gray-700">Date</label>
                <input type="date" id="expDate" required
                       [value]="expDate()" (input)="expDate.set($event.target.value)"
                       class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm p-3 border focus:ring-red-500 focus:border-red-500">
              </div>
            </div>

            <div class="flex justify-end space-x-3 pt-4">
              <button type="button" (click)="closeExpenseModal()" class="btn-secondary">
                Cancel
              </button>
              <button type="submit" class="btn-primary bg-red-600 hover:bg-red-700">
                ${isEdit ? 'Save Changes' : 'Record Expense'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // Renders the Generic Confirmation Modal
  renderConfirmModal(): string {
    if (!this.isConfirmModalOpen()) return '';

    return `
      <div class="modal-backdrop">
        <div class="modal-content">
          <h3 class="text-xl font-bold text-gray-900">Confirm Action</h3>
          <p class="text-gray-700">${this.confirmMessage()}</p>
          <div class="flex justify-end space-x-3 pt-4">
            <button type="button" (click)="closeConfirmModal()" class="btn-secondary">
              Cancel
            </button>
            <button type="button" (click)="executeConfirmAction()" class="btn-primary bg-red-600 hover:bg-red-700">
              Confirm Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
