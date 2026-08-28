// Fill out your copyright notice in the Description page of Project Settings.

#include "Cloth.h"
#include "ClothParticle.h"
#include "ClothConstraint.h"
#include "ClothSphere.h"
#include "Kismet/GameplayStatics.h"
#include "ProceduralMeshComponent.h"
#include "KismetProceduralMeshLibrary.h"

// Helper function to randomise TArray
template<typename T>
void ShuffleArray(TArray<T>& Array)
{
	// Iterate from the last element to the second element
	for (int32 i = Array.Num() - 1; i > 0; --i)
	{
		// Generate a random index from 0 to i
		int32 RandomIndex = FMath::RandRange(0, i);

		// Swap the current element with the random index
		Array.Swap(i, RandomIndex);
	}
}


// Sets default values
ACloth::ACloth()
{
	// Set this actor to call Tick() every frame.  You can turn this off to improve performance if you don't need it.
	PrimaryActorTick.bCanEverTick = true;

	ClothMesh = CreateDefaultSubobject<UProceduralMeshComponent>("ProceduralMesh");
	ClothMesh->SetupAttachment(RootComponent);




}

// Called when the game starts or when spawned
void ACloth::BeginPlay()
{
	Super::BeginPlay();

	ClothMesh->SetMaterial(0, ClothMaterial);

	CreateParticles();
	CreateConstraints();

	



	GenerateMesh();
	ConstrictCloth(ClothConstrictPercentage);


	GetWorldTimerManager().SetTimer(UpdateTimer, this, &ACloth::Update, TimeStep, true);
}

void ACloth::Destroyed()
{
	CleanUp();

	Super::Destroyed();
}

void ACloth::CleanUp()
{
	for (int Vert = 0; Vert < Particles.Num(); Vert++)
	{
		for (int Horz = 0; Horz < Particles[Vert].Num(); Horz++)
		{
			delete Particles[Vert][Horz];
		}
	}

	for (auto iter : Constraints)
	{
		delete iter;
	}

	Particles.Empty();
	Constraints.Empty();
}

void ACloth::ResetCloth()
{
	CleanUp();

	CreateParticles();
	CreateConstraints();
	ConstrictCloth(ClothConstrictPercentage);
}

void ACloth::ConstrictCloth(float _constrictedAmount)
{
	// Calculate constricted dimensions
	float ConstrictedWidth = ClothWidth * _constrictedAmount;
	float ConstrictedDist = ConstrictedWidth / (NumHorzParticles - 1);

	// Determine the starting position (centered around X=0)
	FVector StartPos(0);
	StartPos.X = -ConstrictedWidth / 2.0f;  // Start at the left-most constricted point
	StartPos.Z = ClothHeight / 2.0f;

	// Iterate through horizontal particles
	for (int Horz = 0; Horz < NumHorzParticles; Horz++)
	{
		ClothParticle* Particle = Particles[0][Horz];

		// Calculate new position for this particle
		FVector ParticlePos = FVector(StartPos.X + Horz * ConstrictedDist, StartPos.Y, StartPos.Z);

		// Only adjust pinned particles
		if (Particle->GetPinned())
		{
			Particle->SetPosition(ParticlePos); // Set the calculated position directly
		}
	}
}


void ACloth::AddRandomBurn()
{
	// Randomly select a particle and apply a random burn force
	int VertIndex = FMath::RandRange(0, Particles.Num() - 1);
	int HorzIndex = FMath::RandRange(0, Particles[VertIndex].Num() - 1);
	ClothParticle* Particle = Particles[VertIndex][HorzIndex];

	Particle->AddBurn(0.25f);
}

void ACloth::PropagateBurn()
{
	// Iterate through all particles to check burn status
	for (int Vert = 0; Vert < Particles.Num(); Vert++)
	{
		for (int Horz = 0; Horz < Particles[Vert].Num(); Horz++)
		{
			ClothParticle* Particle = Particles[Vert][Horz];

			// Check if the current particle is burning
			if (Particle->GetBurnAmount() >= 0.9f && (FMath::FRandRange(0.0f, 1.0f) <= 0.05f)) // Near Max Burn
			{
				// Find valid neighboring particles
				TArray<ClothParticle*> ValidNeighbors;

				for (int dVert = -1; dVert <= 1; dVert++)
				{
					for (int dHorz = -1; dHorz <= 1; dHorz++)
					{
						// Skip the particle itself
						if (dVert == 0 && dHorz == 0) continue;

						int NeighborVert = Vert + dVert;
						int NeighborHorz = Horz + dHorz;

						// Ensure indices are within bounds
						if (NeighborVert >= 0 && NeighborVert < Particles.Num() &&
							NeighborHorz >= 0 && NeighborHorz < Particles[NeighborVert].Num())
						{
							ClothParticle* Neighbor = Particles[NeighborVert][NeighborHorz];

							// Check if neighbor is unburnt or just starting to burn
							if (Neighbor && Neighbor->GetBurnAmount() <= 0.1f) // Unburnt threshold
							{
								ValidNeighbors.Add(Neighbor);
							}
						}
					}
				}

				// Propagate to one random valid neighbor
				if (ValidNeighbors.Num() > 0)
				{
					int RandomIndex = FMath::RandRange(0, ValidNeighbors.Num() - 1);
					ClothParticle* SelectedNeighbor = ValidNeighbors[RandomIndex];
					SelectedNeighbor->AddBurn(0.5f); // Start burning
				}
			}
		}
	}
}




void ACloth::DeleteRandomConstraint()
{
	int iRandom = FMath::RandRange(0, Constraints.Num() - 1);

	Constraints[iRandom]->DisableConstraint();
}

// Called every frame
void ACloth::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	GenerateMesh();
}

// This is tied to a fixed framerate (60fps)
void ACloth::Update()
{
	RandomisedConstraints = Constraints;
	float iterationTimeStep = TimeStep / (float)UpdateSteps;
	float DivStep = 1.0f / (float)UpdateSteps;

	
	
	// Call Update on all particles
	for (int Vert = 0; Vert < Particles.Num(); Vert++)
	{
		for (int Horz = 0; Horz < Particles[Vert].Num(); Horz++)
		{
			ClothParticle* Particle = Particles[Vert][Horz];
			float Mass = 1.0f;

			// Adding Acceleration
			FVector gravity = { 0, 0, -981.0f * Mass * TimeStep};
			CalculateWindVector();
			FVector cachedWindVector = WindVector;

			int index = Horz + Particles[Vert].Num() * Vert;
			float dotProduct = FVector::DotProduct(ClothNormals[index], cachedWindVector);
			float windForceMultiplier = (abs(dotProduct) <= 0.1) ? 0.1 : abs(dotProduct);
			cachedWindVector *= windForceMultiplier * Mass * TimeStep * TimeStep;

			Particle->AddForce(gravity);
			Particle->AddForce(cachedWindVector);

			// Update
			Particle->Update(TimeStep);
		}
	}


	for (int i = 0; i < UpdateSteps; i++)
	{
	
		for (auto iter : RandomisedConstraints)
		{
			if (iter->GetInterwoven() && !SimulateInterwovenConstraints)
			{
				continue;
			}
			iter->Update(DivStep);
		}
		
		ShuffleArray(RandomisedConstraints);
	}

	// Fire spread
	PropagateBurn();

	// Check Collisions
	CheckForCollision();


}

void ACloth::CalculateWindVector()
{
	WindVector = WindRotation.Vector();

	WindVector.Normalize();
	
	float WindStrength = FMath::Lerp(MinWindStrength / 2, MaxWindStrength / 2, FMath::Sin(GetGameTimeSinceCreation() * WindOscillationFrequency) * 0.5f + 0.5f);
	float WindStrength2 = FMath::Lerp(MinWindStrength / 2, MaxWindStrength / 2, FMath::Sin(GetGameTimeSinceCreation() * WindOscillationFrequency2) * 0.5f + 0.5f);

	TotalWindStrength = WindStrength + WindStrength2;

	WindVector *= TotalWindStrength;
}

void ACloth::CheckForCollision()
{
	// Cache the sphere reference once
	Sphere = Cast<AClothSphere>(UGameplayStatics::GetActorOfClass(GetWorld(), AClothSphere::StaticClass()));

	if (Sphere)
	{
		FVector SpherePosition = Sphere->GetActorLocation();
		float Radius = Sphere->GetSphereRadius();

		// Draw the sphere's collision volume for debugging
		DrawDebugSphere(GetWorld(), SpherePosition, Radius, 32, FColor::Red, false, 0.1f);
	}

	// Iterate through all particles
	for (int Vert = 0; Vert < Particles.Num(); Vert++)
	{
		for (int Horz = 0; Horz < Particles[Vert].Num(); Horz++)
		{
			ClothParticle* Particle = Particles[Vert][Horz];

			// Check for ground collision
			float GroundHeight = 0.0f - ClothMesh->GetComponentLocation().Z;
			Particle->CheckForGroundCollision(GroundHeight);

			// Check for sphere collision
			if (Sphere)
			{
				Particle->CheckForSphereCollision(Sphere, GetActorLocation());
				// Draw particle positions for debugging
				DrawDebugPoint(GetWorld(), Particle->GetPosition() + GetActorLocation(), 5.0f, FColor::Blue, false, 0.1f);
			}
		}
	}
}



void ACloth::ReleaseCloth()
{
	for (int Horz = 0; Horz < NumHorzParticles; Horz++)
	{
		Particles[0][Horz]->SetPinned(false);
	}
}

void ACloth::CreateParticles()
{
	HorzDist = ClothWidth / (NumHorzParticles - 1);
	VertDist = ClothHeight / (NumVertParticles - 1);

	FVector StartPos(0);
	StartPos.X = -ClothWidth / 2;
	StartPos.Y = ClothHeight / 2;

	for (int Vert = 0; Vert < NumVertParticles; Vert++)
	{
		TArray<ClothParticle*> ParticleRow;

		for (int Horz = 0; Horz < NumHorzParticles; Horz++)
		{
			FVector ParticlePos = { StartPos.X + Horz * HorzDist, StartPos.Y, StartPos.Z - Vert * VertDist };

			ClothParticle* NewParticle = new ClothParticle(ParticlePos);

			// Pinning only if top row
			// Always pin start and end
			int numInteriorHooks = AmountOfPins - 2;

			bool ShouldPin = false;
			for (int i = 0; i < numInteriorHooks; i++)
			{
				float Percentage = 1.0f / (numInteriorHooks + 1);
				Percentage *= i + 1;
				Percentage *= NumHorzParticles - 1;
				int PinnedIndex = FMath::RoundToInt(Percentage);

				if (PinnedIndex == Horz)
				{
					ShouldPin = true;
					break;
				}
			}
			bool Pinned = Vert == 0 && (Horz == 0 || Horz == NumHorzParticles - 1 || ShouldPin);
			NewParticle->SetPinned(Pinned);

			ParticleRow.Add(NewParticle);
		}

		Particles.Add(ParticleRow);
	}
}

void ACloth::CreateConstraints()
{
	for (int Vert = 0; Vert < NumVertParticles; Vert++)
	{
		for (int Horz = 0; Horz < NumHorzParticles; Horz++)
		{
			if (Vert < NumVertParticles - 1)
			{
				// Make a vertical constraint
				class ClothConstraint* NewConstraint = new ClothConstraint(Particles[Vert][Horz], Particles[Vert + 1][Horz]);

				Constraints.Add(NewConstraint);
				
				Particles[Vert][Horz]->AddConstraint(NewConstraint);
				Particles[Vert + 1][Horz]->AddConstraint(NewConstraint);
			}
			if (Vert < NumVertParticles - 2)
			{
				// Make a vertical INTERWOVEN constraint
				class ClothConstraint* NewConstraint = new ClothConstraint(Particles[Vert][Horz], Particles[Vert + 2][Horz]);

				Constraints.Add(NewConstraint);

				// SET AS INTERWOVEN CONSTRAINT
				NewConstraint->SetInterwoven(true);
				Particles[Vert][Horz]->AddConstraint(NewConstraint);
				Particles[Vert + 2][Horz]->AddConstraint(NewConstraint);
			}
			if (Horz < NumHorzParticles - 1)
			{
				// Make a vertical constraint
				ClothConstraint* NewConstraint = new ClothConstraint(Particles[Vert][Horz], Particles[Vert][Horz + 1]);
				
				Constraints.Add(NewConstraint);
				
				Particles[Vert][Horz]->AddConstraint(NewConstraint);
				Particles[Vert][Horz + 1]->AddConstraint(NewConstraint);
			}
			if (Horz < NumHorzParticles - 2)
			{
				// Make a vertical INTERWOVEN constraint
				ClothConstraint* NewConstraint = new ClothConstraint(Particles[Vert][Horz], Particles[Vert][Horz + 2]);

				Constraints.Add(NewConstraint);

				// SET AS INTERWOVEN CONSTRAINT
				NewConstraint->SetInterwoven(true);
				Particles[Vert][Horz]->AddConstraint(NewConstraint);
				Particles[Vert][Horz + 2]->AddConstraint(NewConstraint);
			}
		}

	}

	RandomisedConstraints = Constraints;
}

void ACloth::GenerateMesh()
{
	ClothVertices.Reset();
	ClothTriangles.Reset();
	ClothNormals.Reset();
	ClothUVs.Reset();
	ClothColors.Reset();


	for (int Vert = 0; Vert < NumVertParticles; Vert++)
	{
		for (int Horz = 0; Horz < NumHorzParticles; Horz++)
		{
			ClothVertices.Add(Particles[Vert][Horz]->GetPosition());


			// For vertex colour we will use burn amount
			FLinearColor ParticleColor(Particles[Vert][Horz]->GetBurnAmount(), 0.0f, 0.0f, 0.0f);
			ClothColors.Add(ParticleColor);

			ClothUVs.Add(FVector2D(float(Horz) / (NumHorzParticles - 1), float(Vert) / (NumVertParticles - 1)));
		}
	}

	for (int Vert = 0; Vert < NumVertParticles - 1; Vert++)
	{
		for (int Horz = 0; Horz < NumHorzParticles - 1; Horz++)
		{
			TryCreateTriangles(Particles[Vert][Horz], Particles[Vert][Horz + 1],
				Particles[Vert + 1][Horz], Particles[Vert + 1][Horz + 1], Vert * NumHorzParticles + Horz);
		}
	}

	TArray <FProcMeshTangent> ClothTangents;

	UKismetProceduralMeshLibrary::CalculateTangentsForMesh(ClothVertices, ClothTriangles, ClothUVs, ClothNormals, ClothTangents);
	
	ClothMesh->CreateMeshSection_LinearColor(0, ClothVertices, ClothTriangles, ClothNormals, ClothUVs, ClothColors, ClothTangents, false);
}

void ACloth::TryCreateTriangles(ClothParticle* _topLeft, ClothParticle* _topRight, ClothParticle* _bottomLeft, ClothParticle* _bottomRight, int _topLeftIndex)
{
	int TopLeftIndex = _topLeftIndex;
	int TopRightIndex = _topLeftIndex + 1;
	int BottomLeftIndex = _topLeftIndex + NumHorzParticles;
	int BottomRightIndex = _topLeftIndex + 1 + NumHorzParticles;

	if (_topLeft->SharesConstraint(_topRight) && _topLeft->SharesConstraint(_bottomLeft))
	{
		ClothTriangles.Add(TopLeftIndex);
		ClothTriangles.Add(TopRightIndex);
		ClothTriangles.Add(BottomLeftIndex);
	
		if (_bottomRight->SharesConstraint(_topRight) && _bottomRight->SharesConstraint(_bottomLeft))
		{
			ClothTriangles.Add(TopRightIndex);
			ClothTriangles.Add(BottomRightIndex);
			ClothTriangles.Add(BottomLeftIndex);
		}
	}
	else if (_bottomLeft->SharesConstraint(_topLeft) && _bottomLeft->SharesConstraint(_bottomRight))
	{
		ClothTriangles.Add(BottomLeftIndex);
		ClothTriangles.Add(TopLeftIndex);
		ClothTriangles.Add(BottomRightIndex);
	
		if (_topRight->SharesConstraint(_bottomRight) && _topRight->SharesConstraint(_topLeft))
		{
			ClothTriangles.Add(TopRightIndex);
			ClothTriangles.Add(BottomRightIndex);
			ClothTriangles.Add(TopLeftIndex);
		}
	}

}