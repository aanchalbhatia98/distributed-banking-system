Accounting Service Microservice
This repository contains the Accounting Service, the foundational microservice for a distributed banking system. It is the Source of Truth for all customer account balances, status, and associated limits.

Project Goals
1.	Independent Persistence: Dedicated PostgreSQL database (using two tables: accounts and customer_read_model).
2.	API Contract: Exposes synchronous REST endpoints for core operations (CRUD, Debit).
3.	Business Logic: Enforces account status rules (e.g., frozen accounts cannot transact) and exposes limits.
4.	Deployment: Containerized via Docker and configured for deployment on Minikube (Kubernetes).

Local Setup & Dependencies
Prerequisites
[Docker] (Docker Desktop)
[Docker Compose]
[Node.js] (v20+)
[Minikube] and [kubectl] (Required for Kubernetes deployment only)
An API client (e.g., Postman, Insomnia, or cURL)


1. Environment Variables
Ensure your .env file is present in the root accounting-service/ directory:
Plaintext
DB_HOST=db
DB_PORT=5432
DB_USER=banking_user
DB_PASSWORD=secret_password
DB_NAME=banking_account_db
PORT=8080
2. Run Locally with Docker Compose
These commands will start the application, the PostgreSQL database, the DB Viewer (Adminer), and the Swagger documentation viewer.
Bash
# 1. Start all services (Postgres, App, Adminer, Swagger UI)
docker-compose up --build -d
Service	Port	Description
Accounting App	http://localhost:8080	The primary API endpoint
Adminer DB Viewer	http://localhost:8081	Web-based PostgreSQL viewer
Swagger Docs	http://localhost:8082	Interactive API documentation
________________________________________
Testing the API
All endpoints are prefixed with /api/v1.
A. Create Account (POST /accounts)
Creates a new account and returns the generated account_id (UUID).
Bash
curl -X POST http://localhost:8080/api/v1/accounts \
-H "Content-Type: application/json" \
-d '{
    "customer_id": "123e4567-e89b-12d3-a456-426614174000",
    "account_number": "98765432101234567890",
    "account_type": "SAVINGS",
    "initial_deposit": 50000.50
}'
B. Fetch Account (GET /accounts/{accountId})
Retrieves the account state (requires the UUID copied from the POST request).
Bash
curl -X GET http://localhost:8080/api/v1/accounts/YOUR_ACCOUNT_UUID
C. Debit Funds (Atomic Update) (POST /accounts/{accountId}/debit)
This endpoint enforces Sufficient Funds and Active Status atomically.
Bash
curl -X POST http://localhost:8080/api/v1/accounts/YOUR_ACCOUNT_UUID/debit \
-H "Content-Type: application/json" \
-d '{"amount": 10000.00}'
________________________________________
Minikube Deployment
The service is configured for Kubernetes deployment using three key files that handle configuration, schema mounting, and deployment/service definitions.
Deployment Sequence (PowerShell)
1.	Start and Configure Docker Context:
PowerShell
minikube start
minikube docker-env | Invoke-Expression
2.	Build the Image Inside Minikube:
PowerShell
docker build -t accounting-service:latest .
3.	Apply All Kubernetes Configuration:
PowerShell
# 1. Configs and Secrets
kubectl apply -f k8s-deployments/01-config-secrets.yaml

# 2. Schema ConfigMap (Guarantees tables exist)
kubectl apply -f k8s-deployments/02a-schema-configmap.yaml

# 3. PostgreSQL Deployment
kubectl apply -f k8s-deployments/02-postgres.yaml

# 4. Accounting Service Deployment
kubectl apply -f k8s-deployments/03-accounting-service.yaml
4.	Access the Deployed Service:
PowerShell
minikube service accounting-service --url
(Use the resulting URL for all remote testing.)
