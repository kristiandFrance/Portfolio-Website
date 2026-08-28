// Fill out your copyright notice in the Description page of Project Settings.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Cloth.generated.h"

class ClothParticle;
class ClothConstraint;
class UProceduralMeshComponent;

UCLASS()
class CLOTHSIMULATION_API ACloth : public AActor
{
    GENERATED_BODY()

public:
    // Sets default values for this actor's properties
    ACloth();

    


protected:
    // Called when the game starts or when spawned
    virtual void BeginPlay() override;
    virtual void Destroyed() override;

    void CreateParticles();
    void CreateConstraints();

    void GenerateMesh();

    void TryCreateTriangles(ClothParticle* _topLeft, ClothParticle* _topRight,
        ClothParticle* _bottomLeft, ClothParticle* _bottomRight,
        int _topLeftIndex);

	void Update();

    void CalculateWindVector();

	void CheckForCollision();

    // Drop the cloth
    UFUNCTION(BlueprintCallable, Category = "Cloth | Functions")
    void ReleaseCloth();
    // Delete Memory and clear the arrays
    void CleanUp();
    // Reset the Cloth
    UFUNCTION(BlueprintCallable, Category = "Cloth | Functions")
    void ResetCloth();
    // Constrict the Cloth
	UFUNCTION(BlueprintCallable, Category = "Cloth | Functions")
    void ConstrictCloth(float _constrictedAmount);

    UPROPERTY(EditDefaultsOnly, Category = Mesh)
    UProceduralMeshComponent* ClothMesh = nullptr;


    UPROPERTY(EditDefaultsOnly, Category = Mesh)
    UMaterial* ClothMaterial = nullptr;

    TArray<FVector> ClothVertices;
    TArray<int32> ClothTriangles;
    TArray<FVector> ClothNormals;
    TArray <FVector2D> ClothUVs;
    TArray <FLinearColor> ClothColors;

    // The Grid of Particles
    TArray<TArray<ClothParticle*>> Particles;

    // The list of all constraints
    TArray<ClothConstraint*> Constraints;
	TArray<ClothConstraint*> RandomisedConstraints;


    // Cloth Properties
    UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = Cloth)
    float ClothWidth = 200.0f;    // in cm
    UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = Cloth)
    float ClothHeight = 200.0f;
    UPROPERTY(EditDefaultsOnly, Category = Cloth)
    int NumHorzParticles = 30;
    UPROPERTY(EditDefaultsOnly, Category = Cloth)
    int NumVertParticles = 30;
    UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = Cloth)
    float ClothConstrictPercentage = 1.0f;
    UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = Cloth)
    int AmountOfPins = 5;
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = Cloth)
    bool SimulateInterwovenConstraints = true;

    float HorzDist;    // cloth width / NumHorzParticles
    float VertDist;    // cloth height / NumVertParticles


    // Simulation properties
    UPROPERTY(EditDefaultsOnly, Category = Simulation)
    FVector WindVector = { 50.0f, 600.0f, 100.0f };
    UPROPERTY(EditDefaultsOnly, Category = Simulation)
    float WindOscillationFrequency = 3.0f;
    UPROPERTY(EditDefaultsOnly, Category = Simulation)
    float WindOscillationFrequency2 = 2.26f;
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = Simulation)
	float TotalWindStrength = 300.0f;
    UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = Simulation)
    float MinWindStrength = 200.0f;
    UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = Simulation)
    float MaxWindStrength = 800.0f;
    UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = Simulation)
    FRotator WindRotation = { 0, 0, 0 };
    UPROPERTY(EditDefaultsOnly, Category = Simulation)
    int UpdateSteps = 5;

    FTimerHandle UpdateTimer;
    float TimeStep = 0.016f; // 60fps

    UFUNCTION(BlueprintCallable)
    void AddRandomBurn();

    void PropagateBurn();

    void DeleteRandomConstraint();

    UPROPERTY()
    class AClothSphere* Sphere = nullptr;

public:
    // Called every frame
    virtual void Tick(float DeltaTime) override;

};