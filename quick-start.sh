#!/bin/bash

# VM Resource Request System - Quick Start Testing Script
# This script helps you quickly set up and test the system

echo "=========================================="
echo "VM Resource Request System - Quick Start"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Check if .env exists
echo -e "${YELLOW}Step 1: Checking environment configuration...${NC}"
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo "Please create .env file from .env.example"
    exit 1
fi
echo -e "${GREEN}✓ .env file found${NC}"
echo ""

# Step 2: Check PostgreSQL
echo -e "${YELLOW}Step 2: Checking PostgreSQL connection...${NC}"
if command -v psql &> /dev/null; then
    if psql -U postgres -lqt | cut -d \| -f 1 | grep -qw vmware_tenant; then
        echo -e "${GREEN}✓ Database 'vmware_tenant' exists${NC}"
    else
        echo -e "${YELLOW}Database 'vmware_tenant' not found. Creating...${NC}"
        createdb -U postgres vmware_tenant
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ Database created successfully${NC}"
        else
            echo -e "${RED}Error: Failed to create database${NC}"
            exit 1
        fi
    fi
else
    echo -e "${RED}Error: psql command not found. Please install PostgreSQL${NC}"
    exit 1
fi
echo ""

# Step 3: Run migrations
echo -e "${YELLOW}Step 3: Running database migrations...${NC}"
for migration in migrations/*.sql; do
    echo "Running $(basename $migration)..."
    psql -U postgres -d vmware_tenant -f "$migration" > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ $(basename $migration) completed${NC}"
    else
        echo -e "${YELLOW}⚠ $(basename $migration) may have already been applied${NC}"
    fi
done
echo ""

# Step 4: Check Node.js
echo -e "${YELLOW}Step 4: Checking Node.js installation...${NC}"
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}✓ Node.js ${NODE_VERSION} found${NC}"
else
    echo -e "${RED}Error: Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi
echo ""

# Step 5: Install backend dependencies
echo -e "${YELLOW}Step 5: Installing backend dependencies...${NC}"
cd backend
if [ ! -d node_modules ]; then
    npm install
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Backend dependencies installed${NC}"
    else
        echo -e "${RED}Error: Failed to install backend dependencies${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Backend dependencies already installed${NC}"
fi
cd ..
echo ""

# Step 6: Install frontend dependencies
echo -e "${YELLOW}Step 6: Installing frontend dependencies...${NC}"
cd frontend
if [ ! -d node_modules ]; then
    npm install
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Frontend dependencies installed${NC}"
    else
        echo -e "${RED}Error: Failed to install frontend dependencies${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Frontend dependencies already installed${NC}"
fi
cd ..
echo ""

# Step 7: Test vCenter connectivity
echo -e "${YELLOW}Step 7: Testing vCenter connectivity...${NC}"
VCENTER_URL="https://10.0.200.100"
VCENTER_USER="administrator@vsphere.local"
VCENTER_PASSWORD="Leinao@323"

RESPONSE=$(curl -k -s -o /dev/null -w "%{http_code}" -X POST \
    "${VCENTER_URL}/rest/com/vmware/cis/session" \
    -u "${VCENTER_USER}:${VCENTER_PASSWORD}")

if [ "$RESPONSE" == "200" ]; then
    echo -e "${GREEN}✓ vCenter connection successful${NC}"
else
    echo -e "${RED}⚠ vCenter connection failed (HTTP ${RESPONSE})${NC}"
    echo "Please verify vCenter credentials and network connectivity"
fi
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Start backend server:"
echo "   cd backend && npm run dev"
echo ""
echo "2. In a new terminal, start frontend:"
echo "   cd frontend && npm run dev"
echo ""
echo "3. Access the application:"
echo "   Frontend: http://localhost:5173"
echo "   Backend API: http://localhost:3000"
echo ""
echo "4. Login with default admin account:"
echo "   Email: admin@leinao.ai"
echo "   Password: admin123"
echo ""
echo "5. Follow the testing guide in TESTING_GUIDE.md"
echo ""
echo "=========================================="
