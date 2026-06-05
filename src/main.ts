import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ─── Security ─────────────────────────────────────────────────────────────
  app.use(helmet());
  app.enableCors({
    origin: [process.env.FRONTEND_URL || '*',"http://10.249.68.188:3000"],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ─── Global prefix & versioning ───────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ─── Validation ───────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,          // Strip unknown properties
      forbidNonWhitelisted: true,
      transform: true,          // Auto-transform payloads to DTO class instances
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => {
        const firstError = errors[0]
        const constraints = firstError?.constraints
        const firstMessage = constraints ? Object.values(constraints)?.[0] : 'Validation Failed'
        throw new BadRequestException(firstMessage)
      }
    }),
  );

  // ─── Global filter & interceptor ──────────────────────────────────────────
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  // ─── Swagger docs ─────────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('NearConnect API')
    .setDescription('NearConnect backend — authentication and beyond')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer(`http://localhost:${process.env.PORT ?? 3000}`, 'Local')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 NearConnect API running at http://localhost:${port}/api/v1`);
  console.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
}

bootstrap();
